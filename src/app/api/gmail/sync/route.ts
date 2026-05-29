import { NextResponse } from "next/server";
import { google } from "googleapis";
import { createClient } from "@/lib/supabase/server";
import type { gmail_v1 } from "googleapis";

// ─── MIME helpers ─────────────────────────────────────────────────────────────

function decode(data: string): string {
  return Buffer.from(data, "base64url").toString("utf-8");
}

function headerVal(
  headers: gmail_v1.Schema$MessagePartHeader[] | undefined,
  name: string
): string {
  return headers?.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? "";
}

function isAttachmentPart(part: gmail_v1.Schema$MessagePart): boolean {
  const cd = headerVal(part.headers, "content-disposition").toLowerCase();
  return cd.startsWith("attachment");
}

// ─── MIME tree walker (postal-mime / Roundcube approach) ──────────────────────
//
// Walks the full MIME tree in one pass, collecting:
//   html  – best HTML body found
//   plain – best plain-text body found
//   cids  – inline image content-id → data URI
//
// Priority rules (per RFC 2046 §5.1.4):
//   multipart/alternative → prefer HTML over plain; last part wins ties
//   multipart/related     → first part is the root body; rest are inline resources
//   multipart/mixed       → walk all parts; skip Content-Disposition: attachment
//   any other multipart/* → walk all parts

interface WalkResult {
  html: string | null;
  plain: string | null;
  cids: Map<string, string>;
}

function walk(
  part: gmail_v1.Schema$MessagePart | undefined,
  acc: WalkResult
): void {
  if (!part) return;

  const mime = (part.mimeType ?? "").toLowerCase();

  // ── Leaf: plain text body ──
  if (mime === "text/plain" && !isAttachmentPart(part) && part.body?.data) {
    acc.plain = acc.plain ?? decode(part.body.data);
    return;
  }

  // ── Leaf: HTML body ──
  if (mime === "text/html" && !isAttachmentPart(part) && part.body?.data) {
    // For multipart/alternative, the last text/html wins (override previous plain)
    acc.html = decode(part.body.data);
    return;
  }

  // ── Leaf: inline image (CID) ──
  if (mime.startsWith("image/") && part.body?.data) {
    const cid = headerVal(part.headers, "content-id")
      .replace(/[<>]/g, "")
      .trim();
    if (cid) {
      const b64 = Buffer.from(part.body.data, "base64url").toString("base64");
      acc.cids.set(cid, `data:${mime};base64,${b64}`);
    }
    return;
  }

  const parts = part.parts ?? [];

  // ── multipart/alternative: walk all; HTML overrides plain (last HTML wins) ──
  if (mime === "multipart/alternative") {
    for (const child of parts) walk(child, acc);
    return;
  }

  // ── multipart/related: first part is root body; rest are inline resources ──
  if (mime === "multipart/related") {
    // Collect inline resources from all parts first
    for (const child of parts) walk(child, acc);
    return;
  }

  // ── multipart/mixed and everything else: walk, skip real attachments ──
  for (const child of parts) {
    if (!isAttachmentPart(child)) walk(child, acc);
  }
}

// Replace cid: references with inlined data URIs
function applyCids(html: string, cids: Map<string, string>): string {
  if (cids.size === 0) return html;
  let out = html;
  for (const [cid, dataUri] of cids) {
    const escaped = cid.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    out = out.replace(new RegExp(`cid:${escaped}`, "gi"), dataUri);
  }
  return out;
}

// Minimal sanitisation — strip scripts and JS handlers; keep all layout HTML/CSS.
// The iframe sandbox already blocks script execution; this is defence-in-depth.
function sanitize(html: string): string {
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
    .replace(/<noscript\b[^<]*(?:(?!<\/noscript>)<[^<]*)*<\/noscript>/gi, "")
    .replace(/\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|\S+)/gi, "")
    .replace(/(href|src|action)\s*=\s*["']javascript:[^"']*["']/gi, '$1="#"')
    .replace(/(href|src|action)\s*=\s*["']data:[^"']*["']/gi, '$1="#"');
}

// ─── Email address parser ─────────────────────────────────────────────────────

function parseEmailAddress(raw: string): { email: string; name: string | null } {
  const angleMatch = raw.match(/<([^>]+)>/);
  const email = angleMatch?.[1] ?? raw.trim();
  const nameMatch = raw.match(/^([^<]+)</);
  const name = nameMatch?.[1]?.trim().replace(/^"|"$/g, "") ?? null;
  return { email, name };
}

// ─── Route ───────────────────────────────────────────────────────────────────

export async function POST() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const missingEnv: string[] = [];
    if (!process.env.GOOGLE_CLIENT_ID) missingEnv.push("GOOGLE_CLIENT_ID");
    if (!process.env.GOOGLE_CLIENT_SECRET) missingEnv.push("GOOGLE_CLIENT_SECRET");
    if (!process.env.GOOGLE_REDIRECT_URI) missingEnv.push("GOOGLE_REDIRECT_URI");
    if (missingEnv.length) {
      return NextResponse.json(
        { error: `Missing env vars: ${missingEnv.join(", ")}` },
        { status: 500 }
      );
    }

    const { data: settings } = await supabase
      .from("gym_settings")
      .select("gmail_refresh_token, gmail_email")
      .eq("user_id", user.id)
      .single();

    if (!settings?.gmail_refresh_token) {
      return NextResponse.json({ error: "Gmail not connected" }, { status: 400 });
    }

    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI
    );
    oauth2Client.setCredentials({ refresh_token: settings.gmail_refresh_token });
    const gmail = google.gmail({ version: "v1", auth: oauth2Client });

    const threadsResponse = await gmail.users.threads.list({
      userId: "me",
      maxResults: 200,
      labelIds: ["INBOX"],
      q: "newer_than:14d category:primary",
    });

    const threads = threadsResponse.data.threads ?? [];
    let synced = 0;
    const dropped: { gmailThreadId: string; reason: string }[] = [];

    for (const thread of threads) {
      if (!thread.id) {
        dropped.push({ gmailThreadId: "(no id)", reason: "thread has no id" });
        continue;
      }

      const threadDetail = await gmail.users.threads.get({
        userId: "me",
        id: thread.id,
        format: "full",
      });

      const messages = threadDetail.data.messages ?? [];
      if (!messages.length) {
        dropped.push({ gmailThreadId: thread.id, reason: "no messages in thread" });
        continue;
      }

      const firstMessage = messages[0];
      const lastMessage = messages[messages.length - 1];
      const subject =
        headerVal(firstMessage.payload?.headers, "subject") || "(no subject)";
      const lastDate = new Date(
        parseInt(lastMessage.internalDate ?? "0")
      ).toISOString();

      const ownEmail = settings.gmail_email?.toLowerCase() ?? "";
      const inboundMsg = messages.find((m) => {
        const from = headerVal(m.payload?.headers, "from").toLowerCase();
        return !from.includes(ownEmail);
      });

      const senderRaw =
        headerVal(inboundMsg?.payload?.headers, "from") ||
        headerVal(firstMessage.payload?.headers, "from");
      const { email: senderEmail, name: senderName } = parseEmailAddress(senderRaw);

      let contactId: string | null = null;
      if (senderEmail && !senderEmail.toLowerCase().includes(ownEmail)) {
        const { data: contact } = await supabase
          .from("contacts")
          .upsert(
            { user_id: user.id, email: senderEmail, name: senderName },
            { onConflict: "user_id,email" }
          )
          .select("id")
          .single();
        contactId = contact?.id ?? null;
      }

      const { data: upsertedThread, error: threadErr } = await supabase
        .from("email_threads")
        .upsert(
          {
            user_id: user.id,
            gmail_thread_id: thread.id,
            contact_id: contactId,
            subject,
            last_message_at: lastDate,
          },
          { onConflict: "user_id,gmail_thread_id" }
        )
        .select("id")
        .single();

      if (!upsertedThread) {
        dropped.push({
          gmailThreadId: thread.id,
          reason: `thread upsert failed: ${threadErr?.message ?? "unknown"}`,
        });
        continue;
      }

      for (const msg of messages) {
        if (!msg.id) continue;

        const fromRaw = headerVal(msg.payload?.headers, "from");
        const toRaw = headerVal(msg.payload?.headers, "to");
        const msgSubject = headerVal(msg.payload?.headers, "subject");
        const sentAt = new Date(parseInt(msg.internalDate ?? "0")).toISOString();
        const isOutbound = fromRaw.toLowerCase().includes(ownEmail);

        const acc: WalkResult = { html: null, plain: null, cids: new Map() };
        walk(msg.payload ?? undefined, acc);

        let bodyText: string;
        if (acc.html) {
          const html = sanitize(applyCids(acc.html, acc.cids));
          bodyText = html.slice(0, 200_000);
        } else {
          bodyText = (acc.plain ?? "").slice(0, 10_000);
        }

        await supabase.from("email_messages").upsert(
          {
            thread_id: upsertedThread.id,
            gmail_message_id: msg.id,
            direction: isOutbound ? "outbound" : "inbound",
            from_email: fromRaw,
            to_email: toRaw,
            subject: msgSubject,
            body_text: bodyText,
            sent_at: sentAt,
          },
          { onConflict: "gmail_message_id" }
        );
      }

      synced++;
    }

    await supabase
      .from("gym_settings")
      .update({ gmail_last_synced_at: new Date().toISOString() })
      .eq("user_id", user.id);

    return NextResponse.json({
      synced,
      gmailThreadCount: threads.length,
      resultSizeEstimate: threadsResponse.data.resultSizeEstimate ?? null,
      dropped,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[gmail/sync] failed", err);
    return NextResponse.json(
      { error: message, name: err instanceof Error ? err.name : undefined },
      { status: 500 }
    );
  }
}
