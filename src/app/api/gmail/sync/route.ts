import { NextResponse } from "next/server";
import { google } from "googleapis";
import { createClient } from "@/lib/supabase/server";
import type { gmail_v1 } from "googleapis";

function extractBody(payload: gmail_v1.Schema$MessagePart | undefined): string {
  if (!payload) return "";
  if (payload.body?.data) {
    return Buffer.from(payload.body.data, "base64url").toString("utf-8");
  }
  if (payload.parts) {
    const textPart = payload.parts.find((p) => p.mimeType === "text/plain");
    if (textPart?.body?.data) {
      return Buffer.from(textPart.body.data, "base64url").toString("utf-8");
    }
    for (const part of payload.parts) {
      const body = extractBody(part);
      if (body) return body;
    }
  }
  return "";
}

function getHeader(headers: gmail_v1.Schema$MessagePartHeader[] | undefined, name: string): string {
  return headers?.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value || "";
}

function parseEmailAddress(raw: string): { email: string; name: string | null } {
  const angleMatch = raw.match(/<([^>]+)>/);
  const email = angleMatch?.[1] || raw.trim();
  const nameMatch = raw.match(/^([^<]+)</);
  const name = nameMatch?.[1]?.trim().replace(/^"|"$/g, "") || null;
  return { email, name };
}

export async function POST() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

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
    maxResults: 30,
    labelIds: ["INBOX"],
    q: "newer_than:14d",
  });

  const threads = threadsResponse.data.threads || [];
  let synced = 0;

  for (const thread of threads) {
    if (!thread.id) continue;

    const threadDetail = await gmail.users.threads.get({
      userId: "me",
      id: thread.id,
      format: "full",
    });

    const messages = threadDetail.data.messages || [];
    if (!messages.length) continue;

    const firstMessage = messages[0];
    const lastMessage = messages[messages.length - 1];
    const subject = getHeader(firstMessage.payload?.headers, "subject") || "(no subject)";
    const lastDate = new Date(parseInt(lastMessage.internalDate || "0")).toISOString();

    // Find the first inbound (non-gym) sender
    const ownEmail = settings.gmail_email?.toLowerCase() || "";
    const inboundMsg = messages.find((m) => {
      const from = getHeader(m.payload?.headers, "from").toLowerCase();
      return !from.includes(ownEmail);
    });

    const senderRaw = getHeader(inboundMsg?.payload?.headers, "from") ||
      getHeader(firstMessage.payload?.headers, "from");
    const { email: senderEmail, name: senderName } = parseEmailAddress(senderRaw);

    // Skip if the sender is the gym's own email
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
      contactId = contact?.id || null;
    }

    // Upsert thread
    const { data: upsertedThread } = await supabase
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

    if (!upsertedThread) continue;

    // Upsert each message
    for (const msg of messages) {
      if (!msg.id) continue;
      const fromRaw = getHeader(msg.payload?.headers, "from");
      const toRaw = getHeader(msg.payload?.headers, "to");
      const msgSubject = getHeader(msg.payload?.headers, "subject");
      const sentAt = new Date(parseInt(msg.internalDate || "0")).toISOString();
      const bodyText = extractBody(msg.payload || undefined).slice(0, 10000);
      const isOutbound = fromRaw.toLowerCase().includes(ownEmail);

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

  return NextResponse.json({ synced });
}
