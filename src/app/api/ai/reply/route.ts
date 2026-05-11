import { NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { createClient } from "@/lib/supabase/server";
import type { EmailClassification, EmailMessage } from "@/lib/types";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

function toPlainText(text: string): string {
  if (!text.trimStart().startsWith("<")) return text;
  return text
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

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { threadId, subject, messages, classification } = await request.json() as {
    threadId: string;
    subject: string;
    messages: EmailMessage[];
    classification: EmailClassification;
  };

  const { data: settings } = await supabase
    .from("gym_settings")
    .select("gym_name, gym_context")
    .eq("user_id", user.id)
    .single();

  const gymName = settings?.gym_name || "our gym";
  const gymContext = settings?.gym_context || "";

  const conversationContext = (messages || [])
    .slice(-5)
    .map((m: EmailMessage) =>
      `${m.direction === "inbound" ? "THEM" : "US"}: ${toPlainText(m.body_text || "").slice(0, 400)}`
    )
    .join("\n\n");

  const prompt = `You are helping ${gymName}, a boxing/martial arts gym, reply to an email.

Gym context: ${gymContext}

Conversation:
${conversationContext}

Write a reply that is:
- Under 120 words
- Friendly and warm, like a coach talking to someone
- Ends with a clear next step or question
- No corporate language or jargon

Respond with JSON only (no markdown): { "subject": "Re: ${subject.replace(/^Re:\s*/i, "")}", "body": "..." }`;

  const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
  const result = await model.generateContent({
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: { maxOutputTokens: 300 },
  });

  const text = result.response.text().trim();
  const jsonMatch = text.match(/\{[\s\S]*\}/);

  let generated = { subject: `Re: ${subject.replace(/^Re:\s*/i, "")}`, body: "" };
  if (jsonMatch) {
    try {
      generated = JSON.parse(jsonMatch[0]);
    } catch {
      generated.body = text;
    }
  }

  // Persist the generation
  const { data: generation } = await supabase
    .from("ai_generations")
    .insert({
      user_id: user.id,
      thread_id: threadId,
      type: "reply",
      generated_subject: generated.subject,
      generated_body: generated.body,
      confidence: classification?.confidence ?? 0.8,
      risk_level: classification?.risk_level ?? "low",
      status: "pending",
    })
    .select()
    .single();

  return NextResponse.json({ generation, subject: generated.subject, body: generated.body });
}
