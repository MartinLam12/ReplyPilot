import { NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { createClient } from "@/lib/supabase/server";
import type { EmailClassification, EmailMessage } from "@/lib/types";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

// ─── Classification ───────────────────────────────────────────────────────────

function quickClassify(subject: string, context: string): EmailClassification {
  const h = `${subject}\n${context}`.toLowerCase();
  if (/(cancel|cancellation|refund|chargeback|stop membership|terminate|quit)/.test(h))
    return { type: "cancellation", risk_level: "high", confidence: 0.92, contact_type_guess: "member", summary: "Potential cancellation request requiring manual handling." };
  if (/(angry|upset|terrible|awful|bad service|frustrat|disappointed|unhappy)/.test(h))
    return { type: "complaint", risk_level: "high", confidence: 0.9, contact_type_guess: "member", summary: "Potential complaint requiring a careful manual response." };
  if (/(bill|billing|charged|charge|payment|invoice|price wrong|overcharged)/.test(h))
    return { type: "billing", risk_level: "high", confidence: 0.9, contact_type_guess: "member", summary: "Potential billing issue requiring manual review." };
  if (/(class|schedule|time|coach|instructor|session|availability)/.test(h))
    return { type: "class_inquiry", risk_level: "low", confidence: 0.84, contact_type_guess: "unknown", summary: "Class details or scheduling question." };
  if (/(trial|free trial|join|membership|price|pricing|plans|sign up|drop in)/.test(h))
    return { type: "lead_inquiry", risk_level: "low", confidence: 0.86, contact_type_guess: "lead", summary: "Lead or trial inquiry." };
  return { type: "general", risk_level: "low", confidence: 0.75, contact_type_guess: "unknown", summary: "General inbound message." };
}

// ─── Tone guide per classification ────────────────────────────────────────────

const TONE: Record<string, string> = {
  class_inquiry: "helpful — answer the schedule/class question directly",
  lead_inquiry: "warm and inviting — make them excited to come in for a trial",
  general: "friendly and professional, like a helpful coach",
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toPlainText(text: string): string {
  const raw = (text || "").slice(0, 800);
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

// ─── Route ────────────────────────────────────────────────────────────────────

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { subject, messages } = await request.json() as {
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
  const cleanSubject = (subject || "").replace(/^Re:\s*/i, "");

  const conversationSnippet = (messages || [])
    .slice(-2)
    .map((m) => `${m.direction === "inbound" ? "THEM" : "US"}: ${toPlainText(m.body_text || "").slice(0, 180)}`)
    .join("\n\n");

  const classification = quickClassify(subject || "", conversationSnippet);
  const replySubject = `Re: ${cleanSubject}`;

  if (classification.risk_level === "high") {
    return NextResponse.json({ classification, generation: null, subject: replySubject, body: "" });
  }

  const tone = TONE[classification.type] ?? TONE.general;

  const prompt = `Write a short email reply for ${gymName}.${gymContext ? ` Context: ${gymContext}` : ""}
Tone: ${tone}
Subject: ${cleanSubject}
${conversationSnippet}

Under 85 words. Friendly, like a coach. End with one clear next step. Write only the reply body — no subject line.`;

  try {
    const result = await model.generateContent({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { maxOutputTokens: 130, temperature: 0.3 },
    });
    const body = stripFences(result.response.text() || "").trim();
    return NextResponse.json({ classification, generation: null, subject: replySubject, body });
  } catch (err) {
    console.error("[generate] LLM error:", err);
    return NextResponse.json(
      { classification, generation: null, subject: replySubject, body: "", error: true },
      { status: 500 }
    );
  }
}
