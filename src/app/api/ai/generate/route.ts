import { NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { createClient } from "@/lib/supabase/server";
import type { EmailClassification, EmailMessage } from "@/lib/types";

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

function quickClassify(subject: string, context: string): EmailClassification {
  const haystack = `${subject}\n${context}`.toLowerCase();

  if (/(cancel|cancellation|refund|chargeback|stop membership|terminate|quit)/.test(haystack))
    return { type: "cancellation", risk_level: "high", confidence: 0.92, contact_type_guess: "member", summary: "Potential cancellation request requiring manual handling." };
  if (/(angry|upset|terrible|awful|bad service|frustrat|disappointed|unhappy)/.test(haystack))
    return { type: "complaint", risk_level: "high", confidence: 0.9, contact_type_guess: "member", summary: "Potential complaint requiring a careful manual response." };
  if (/(bill|billing|charged|charge|payment|invoice|price wrong|overcharged)/.test(haystack))
    return { type: "billing", risk_level: "high", confidence: 0.9, contact_type_guess: "member", summary: "Potential billing issue requiring manual review." };
  if (/(class|schedule|time|coach|instructor|session|availability)/.test(haystack))
    return { type: "class_inquiry", risk_level: "low", confidence: 0.84, contact_type_guess: "unknown", summary: "Class details or scheduling question." };
  if (/(trial|free trial|join|membership|price|pricing|plans|sign up|drop in)/.test(haystack))
    return { type: "lead_inquiry", risk_level: "low", confidence: 0.86, contact_type_guess: "lead", summary: "Lead or trial inquiry." };

  return { type: "general", risk_level: "low", confidence: 0.75, contact_type_guess: "unknown", summary: "General inbound message." };
}

function stripFences(text: string): string {
  return text.replace(/^```[a-zA-Z]*\n?/g, "").replace(/```$/g, "").trim();
}

export async function POST(request: Request) {
  console.log("[generate] route hit");
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    console.log("[generate] unauthorized");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  console.log("[generate] user:", user.id);

  const { subject, messages } = await request.json() as {
    threadId: string;
    subject: string;
    messages: EmailMessage[];
  };

  const gymName = "our gym";
  const gymContext = "";

  const conversationContext = (messages || [])
    .slice(-2)
    .map((m: EmailMessage) =>
      `${m.direction === "inbound" ? "THEM" : "US"}: ${toPlainText(m.body_text || "").slice(0, 180)}`
    )
    .join("\n\n");

  const cleanSubject = (subject || "").replace(/^Re:\s*/i, "");
  const classification = quickClassify(subject || "", conversationContext);
  console.log("[generate] classification:", classification.type, classification.risk_level);

  if (classification.risk_level === "high") {
    return NextResponse.json({ classification, generation: null, subject: `Re: ${cleanSubject}`, body: "" });
  }

  const prompt = `Write a short reply for ${gymName}, a boxing/martial arts gym.
${gymContext ? `Gym context: ${gymContext}` : ""}

Subject: ${subject || "(no subject)"}
Conversation:
${conversationContext}

Rules:
- Under 85 words
- Friendly and warm, like a coach
- Include one clear next step/question
- No markdown, no JSON, no greeting repetition

Return only the reply body text.`;

  const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash-lite" });

  console.log("[generate] calling Gemini...");
  try {
    const result = await model.generateContent({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { maxOutputTokens: 140, temperature: 0.4 },
    });

    const replyBody = stripFences(result.response.text() || "").trim();
    console.log("[generate] reply length:", replyBody.length, "chars");
    return NextResponse.json({ classification, generation: null, subject: `Re: ${cleanSubject}`, body: replyBody });
  } catch (err) {
    console.error("[generate] LLM error:", err);
    return NextResponse.json(
      { classification, generation: null, subject: `Re: ${cleanSubject}`, body: "", error: true },
      { status: 500 }
    );
  }
}
