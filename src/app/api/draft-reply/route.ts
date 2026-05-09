import { GoogleGenerativeAI } from "@google/generative-ai";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

export async function POST(request: Request) {
  const { fromEmail, subject, body, gymName, gymContext } = await request.json();

  if (!body) {
    return Response.json({ error: "Email body is required" }, { status: 400 });
  }

  const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

  const prompt = `You are a friendly and professional staff member at ${gymName || "a boxing gym"}.
${gymContext ? `Gym context: ${gymContext}` : ""}

Draft a warm, concise reply to this incoming email. Keep it under 150 words. Sign off as "${gymName || "The Team"}".

From: ${fromEmail || "Unknown"}
Subject: ${subject || "No subject"}
Message:
${body}

Write only the email reply body — no subject line, no explanation.`;

  const result = await model.generateContent(prompt);
  const draft = result.response.text();

  const replySubject = subject?.startsWith("Re:") ? subject : `Re: ${subject || "Your inquiry"}`;

  return Response.json({ subject: replySubject, body: draft });
}
