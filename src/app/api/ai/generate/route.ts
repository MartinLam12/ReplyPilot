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

function quickClassify(subject: string, context: string): EmailClassification {
  const haystack = `${subject}\n${context}`.toLowerCase();

  const cancellation = /(cancel|cancellation|refund|chargeback|stop membership|terminate|quit)/.test(
    haystack
  );
  const complaint = /(angry|upset|terrible|awful|bad service|frustrat|disappointed|unhappy)/.test(
    haystack
  );
  const billing = /(bill|billing|charged|charge|payment|invoice|price wrong|overcharged)/.test(
    haystack
  );

  if (cancellation) {
    return {
      type: "cancellation",
      risk_level: "high",
      confidence: 0.92,
      contact_type_guess: "member",
      summary: "Potential cancellation request requiring manual handling.",
    };
  }

  if (complaint) {
    return {
      type: "complaint",
      risk_level: "high",
      confidence: 0.9,
      contact_type_guess: "member",
      summary: "Potential complaint requiring a careful manual response.",
    };
  }

  if (billing) {
    return {
      type: "billing",
      risk_level: "high",
      confidence: 0.9,
      contact_type_guess: "member",
      summary: "Potential billing issue requiring manual review.",
    };
  }

  const classInquiry = /(class|schedule|time|coach|instructor|session|availability)/.test(haystack);
  const leadInquiry = /(trial|free trial|join|membership|price|pricing|plans|sign up|drop in)/.test(
    haystack
  );

  if (classInquiry) {
    return {
      type: "class_inquiry",
      risk_level: "low",
      confidence: 0.84,
      contact_type_guess: "unknown",
      summary: "Class details or scheduling question.",
    };
  }

  if (leadInquiry) {
    return {
      type: "lead_inquiry",
      risk_level: "low",
      confidence: 0.86,
      contact_type_guess: "lead",
      summary: "Lead or trial inquiry.",
    };
  }

  return {
    type: "general",
    risk_level: "low",
    confidence: 0.75,
    contact_type_guess: "unknown",
    summary: "General inbound message.",
  };
}

function stripFences(text: string): string {
  return text.replace(/^```[a-zA-Z]*\n?/g, "").replace(/```$/g, "").trim();
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
    .slice(-3)
    .map((m: EmailMessage) =>
      `${m.direction === "inbound" ? "THEM" : "US"}: ${toPlainText(m.body_text || "").slice(0, 260)}`
    )
    .join("\n\n");

  const cleanSubject = (subject || "").replace(/^Re:\s*/i, "");

  const classification = quickClassify(subject || "", conversationContext);

  if (classification.risk_level === "high") {
    return NextResponse.json({
      classification,
      generation: null,
      subject: `Re: ${cleanSubject}`,
      body: "",
    });
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

  const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
  const result = await model.generateContent({
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: { maxOutputTokens: 220, temperature: 0.4 },
  });

  const replyBody = stripFences(result.response.text() || "").trim();
  const replySubject = `Re: ${cleanSubject}`;

  let generation = null;
  if (replyBody) {
    const { data } = await supabase
      .from("ai_generations")
      .insert({
        user_id: user.id,
        thread_id: threadId,
        type: "reply",
        generated_subject: replySubject,
        generated_body: replyBody,
        confidence: classification.confidence,
        risk_level: classification.risk_level,
        status: "pending",
      })
      .select()
      .single();
    generation = data;
  }

  return NextResponse.json({
    classification,
    generation,
    subject: replySubject,
    body: replyBody,
  });
}
