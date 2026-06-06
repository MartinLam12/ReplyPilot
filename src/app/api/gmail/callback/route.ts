import { NextResponse } from "next/server";
import { google } from "googleapis";
import { createRouteClient } from "@/lib/supabase/route";
import { encryptToken } from "@/lib/token-crypto";
import type { NextRequest } from "next/server";

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const error = searchParams.get("error");
  const state = searchParams.get("state");

  if (error || !code) {
    return NextResponse.redirect(`${origin}/settings?error=gmail_denied`);
  }

  // Verify the state parameter matches the cookie set in /api/gmail/auth.
  // A missing or mismatched state means this request was not initiated by this
  // session — reject it to prevent CSRF (attacker linking their Gmail to the
  // victim's account).
  const expectedState = request.cookies.get("oauth_gmail_state")?.value;
  if (!state || !expectedState || state !== expectedState) {
    return NextResponse.redirect(`${origin}/settings?error=gmail_invalid_state`);
  }

  // Construct the response first so Supabase can write refreshed session cookies onto it.
  const response = NextResponse.redirect(`${origin}/settings?connected=true`);
  const supabase = createRouteClient(request, response);
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.redirect(`${origin}/login`);
  }

  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );

  let tokens;
  try {
    ({ tokens } = await oauth2Client.getToken(code));
  } catch {
    return NextResponse.redirect(`${origin}/settings?error=gmail_auth_failed`);
  }

  // Get the connected Gmail address
  oauth2Client.setCredentials(tokens);
  const gmail = google.gmail({ version: "v1", auth: oauth2Client });
  const profile = await gmail.users.getProfile({ userId: "me" });
  const gmailEmail = profile.data.emailAddress || "";

  const { error: upsertError } = await supabase.from("gym_settings").upsert(
    {
      user_id: user.id,
      gmail_email: gmailEmail,
      gmail_refresh_token: encryptToken(tokens.refresh_token || ""),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" }
  );
  if (upsertError) {
    return NextResponse.redirect(`${origin}/settings?error=gmail_auth_failed`);
  }

  // Clear the state cookie now that it has been consumed.
  response.cookies.set("oauth_gmail_state", "", { maxAge: 0, path: "/" });
  return response;
}
