import { NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { createClient } from "@/lib/supabase/server";
import { retrieveStyleContext, buildStylePromptSection } from "@/lib/style-memory";
import { enforceDailyLimit } from "@/lib/usage-limits";
import type { EmailMessage } from "@/lib/types";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
const MAX_RAW_EMAIL_CHARS = 12000;

function toPlainText(text: string): string {
  const raw = (text || "").slice(0, MAX_RAW_EMAIL_CHARS);
  if (!raw.trimStart().startsWith("<")) return raw;
  return raw
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function stripFences(text: string): string {
  return text.replace(/^```[a-zA-Z]*\n?/g, "").replace(/```$/g, "").trim();
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const limit = await enforceDailyLimit(supabase, "generate");
  if (!limit.allowed) {
    return NextResponse.json(
      { generation: null, subject: "", body: "", error: limit.message },
      { status: 429 }
    );
  }

  const { subject, messages } = await request.json() as {
    threadId: string;
    subject: string;
    messages: EmailMessage[];
  };

  const { data: gymSettings } = await supabase
    .from("gym_settings")
    .select("gym_name, gym_context")
    .eq("user_id", user.id)
    .single();

  const gymName    = gymSettings?.gym_name?.trim()    || "our gym";
  const gymContext = gymSettings?.gym_context?.trim() || "";

  const conversationContext = (messages || [])
    .slice(-2)
    .map((m: EmailMessage) =>
      `${m.direction === "inbound" ? "THEM" : "US"}: ${toPlainText(m.body_text || "").slice(0, 180)}`
    )
    .join("\n\n");

  const cleanSubject = (subject || "").replace(/^Re:\s*/i, "");

  // ── Style retrieval (runs concurrently, never blocks) ──────────────────────
  // Queries the user's past replies for similar emails and builds a style section.
  // Falls back to null if the user has no samples yet — prompt degrades gracefully.
  const inboundText = (messages || [])
    .filter((m) => m.direction === "inbound")
    .slice(-1)
    .map((m) => toPlainText(m.body_text || "").slice(0, 400))
    .join("\n") || subject || "";

  const styleCtx = await retrieveStyleContext(supabase, user.id, inboundText);
  const styleSection = buildStylePromptSection(styleCtx);
  const hasStyleExamples = !!styleCtx?.examples?.length;

  // ── Prompt ─────────────────────────────────────────────────────────────────
  // When the user has provided style examples, the example voice wins and we
  // drop the "friendly and warm, like a coach" default — otherwise that line
  // overrides the user's actual writing style (e.g. old-English samples were
  // getting rewritten into modern coach-speak).
  const toneRule = hasStyleExamples
    ? "- Match the voice, tone, vocabulary, and sentence rhythm of the [Example] replies above as closely as possible — including any unusual register such as formal or archaic English"
    : "- Friendly and warm, like a coach";

  const prompt = `Write a reply for ${gymName}, a boxing/martial arts gym.
${gymContext ? `\nReply rules — follow these exactly:\n${gymContext}\n` : ""}${styleSection ? `\n${styleSection}` : ""}Subject: ${subject || "(no subject)"}
Conversation:
${conversationContext}

Rules:
- Under 100 words
${toneRule}
- Include one clear next step or question
- No markdown, no JSON

Return only the reply body text.`;

  const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash-lite" });

  try {
    const result = await model.generateContent({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { maxOutputTokens: 160, temperature: 0.4 },
    });

    const replyBody = stripFences(result.response.text() || "").trim();
    return NextResponse.json({ generation: null, subject: `Re: ${cleanSubject}`, body: replyBody });
  } catch (err) {
    console.error("[generate] LLM error:", err);
    return NextResponse.json(
      { generation: null, subject: `Re: ${cleanSubject}`, body: "", error: true },
      { status: 500 }
    );
  }
}
