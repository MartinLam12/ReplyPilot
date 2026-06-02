import { NextResponse } from "next/server";
import { google } from "googleapis";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { threadId, gmailThreadId, to, subject, body } = await request.json();

  // Reject CR/LF in header-bound fields — they would otherwise inject extra
  // headers (Bcc:, Reply-To:, …) into the raw MIME payload below.
  if (typeof to !== "string" || typeof subject !== "string" || /[\r\n]/.test(to) || /[\r\n]/.test(subject)) {
    return NextResponse.json({ error: "Invalid header value" }, { status: 400 });
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

  const raw = [
    `From: ${settings.gmail_email}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    `Content-Type: text/plain; charset=utf-8`,
    `MIME-Version: 1.0`,
    ``,
    body,
  ].join("\r\n");

  const sendRes = await gmail.users.messages.send({
    userId: "me",
    requestBody: {
      raw: Buffer.from(raw).toString("base64url"),
      threadId: gmailThreadId,
    },
  });

  const sentAt = new Date().toISOString();

  // Persist the sent reply immediately so it shows in the conversation view
  // without waiting for the next Gmail sync. The real Gmail message id is used
  // as the conflict key, so the next sync's upsert dedupes against this row
  // (and may refine body_text from the canonical MIME).
  const sentMessageId = sendRes.data.id;
  if (sentMessageId) {
    await supabase.from("email_messages").upsert(
      {
        thread_id: threadId,
        gmail_message_id: sentMessageId,
        direction: "outbound",
        from_email: settings.gmail_email,
        to_email: to,
        subject,
        body_text: body,
        sent_at: sentAt,
      },
      { onConflict: "gmail_message_id" }
    );
  }

  // Mark replied and move the thread to the top — the reply is now the latest
  // message, mirroring Gmail's "active conversation rises" behaviour.
  await supabase
    .from("email_threads")
    .update({ status: "replied", last_message_at: sentAt })
    .eq("id", threadId)
    .eq("user_id", user.id);

  return NextResponse.json({ success: true });
}
