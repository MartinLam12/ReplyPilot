import { NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { createClient } from "@/lib/supabase/server";
import type { EmailMessage } from "@/lib/types";

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

  const { threadId, subject, messages } = await request.json() as {
    threadId: string;
    subject: string;
    messages: EmailMessage[];
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

  const cleanSubject = (subject || "").replace(/^Re:\s*/i, "");

  const prompt = `You are helping ${gymName}, a boxing/martial arts gym, manage their inbox.
${gymContext ? `Gym context: ${gymContext}\n` : ""}
Email subject: ${subject || "(no subject)"}
Conversation:
${conversationContext}

Task: classify this email AND write a short reply.

Classification rules:
- complaint, billing dispute, or cancellation request → risk_level: "high" (no reply needed)
- lead inquiry, trial booking, class question → risk_level: "low"
- everything else → risk_level: "low" or "medium"

Reply rules (skip if high risk):
- Under 100 words
- Friendly and warm, like a coach talking to someone
- End with a clear next step or question
- No corporate language

Respond with valid JSON only (no markdown):
{
  "type": "lead_inquiry|complaint|billing|cancellation|general|class_inquiry",
  "risk_level": "low|medium|high",
  "confidence": 0.85,
  "contact_type_guess": "lead|trial|member|unknown",
  "summary": "one sentence plain English",
  "reply_subject": "Re: ${cleanSubject}",
  "reply_body": "reply text, or empty string if high risk"
}`;

  const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
  const result = await model.generateContent({
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: { maxOutputTokens: 500 },
  });

  const text = result.response.text().trim();
  const jsonMatch = text.match(/\{[\s\S]*\}/);

  const defaults = {
    type: "general" as const,
    risk_level: "low" as "low" | "medium" | "high",
    confidence: 0.8,
    contact_type_guess: "unknown" as const,
    summary: "",
    reply_subject: `Re: ${cleanSubject}`,
    reply_body: "",
  };

  let parsed = { ...defaults };
  if (jsonMatch) {
    try {
      parsed = { ...defaults, ...JSON.parse(jsonMatch[0]) };
    } catch { /* use defaults */ }
  }

  let generation = null;
  if (parsed.risk_level !== "high" && parsed.reply_body) {
    const { data } = await supabase
      .from("ai_generations")
      .insert({
        user_id: user.id,
        thread_id: threadId,
        type: "reply",
        generated_subject: parsed.reply_subject,
        generated_body: parsed.reply_body,
        confidence: parsed.confidence,
        risk_level: parsed.risk_level,
        status: "pending",
      })
      .select()
      .single();
    generation = data;
  }

  return NextResponse.json({
    classification: {
      type: parsed.type,
      risk_level: parsed.risk_level,
      confidence: parsed.confidence,
      contact_type_guess: parsed.contact_type_guess,
      summary: parsed.summary,
    },
    generation,
    subject: parsed.reply_subject,
    body: parsed.reply_body,
  });
}
