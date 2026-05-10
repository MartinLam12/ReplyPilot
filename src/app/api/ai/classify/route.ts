import { NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { createClient } from "@/lib/supabase/server";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { subject, body } = await request.json();

  const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

  const prompt = `Classify this email for a boxing/martial arts gym. Respond with valid JSON only, no markdown.

Subject: ${subject || "(none)"}
Body: ${(body || "").slice(0, 2000)}

Return this exact JSON shape:
{
  "type": "lead_inquiry" | "complaint" | "billing" | "cancellation" | "general" | "class_inquiry",
  "risk_level": "low" | "medium" | "high",
  "confidence": 0.85,
  "contact_type_guess": "lead" | "trial" | "member" | "unknown",
  "summary": "One sentence plain English summary"
}

Rules:
- complaint, billing dispute, cancellation request → high risk
- pricing questions, scheduling, trial enquiry → low risk
- general → low or medium`;

  const result = await model.generateContent({
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: { maxOutputTokens: 150 },
  });

  const text = result.response.text().trim();
  const jsonMatch = text.match(/\{[\s\S]*\}/);

  if (!jsonMatch) {
    return NextResponse.json({
      type: "general",
      risk_level: "low",
      confidence: 0.5,
      contact_type_guess: "unknown",
      summary: "Unable to classify",
    });
  }

  try {
    return NextResponse.json(JSON.parse(jsonMatch[0]));
  } catch {
    return NextResponse.json({
      type: "general",
      risk_level: "low",
      confidence: 0.5,
      contact_type_guess: "unknown",
      summary: "Unable to classify",
    });
  }
}
