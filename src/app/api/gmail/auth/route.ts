import { NextResponse } from "next/server";
import { google } from "googleapis";
import { createRouteClient } from "@/lib/supabase/route";
import { randomBytes } from "crypto";
import type { NextRequest } from "next/server";

export async function GET(request: NextRequest) {
  const tempResponse = NextResponse.redirect("http://placeholder");
  const supabase = createRouteClient(request, tempResponse);
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.redirect(new URL("/login", process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"));
  }

  // Generate a per-request state nonce. Stored in an HTTP-only cookie and
  // echoed back by Google's redirect — the callback verifies they match to
  // prevent CSRF (an attacker tricking the victim into using the attacker's
  // OAuth code to replace the victim's Gmail connection).
  const state = randomBytes(32).toString("hex");

  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );

  const authUrl = oauth2Client.generateAuthUrl({
    access_type: "offline",
    scope: [
      "https://www.googleapis.com/auth/gmail.readonly",
      "https://www.googleapis.com/auth/gmail.send",
      "https://www.googleapis.com/auth/gmail.modify",
    ],
    prompt: "consent",
    state,
  });

  const response = NextResponse.redirect(authUrl);
  response.cookies.set("oauth_gmail_state", state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 10, // 10 minutes — long enough for the consent flow
    path: "/",
  });
  return response;
}
