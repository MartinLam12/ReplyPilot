import { GoogleGenerativeAI } from "@google/generative-ai";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

export async function POST(request: Request) {
  const { className, instructor, date, time, location, gymName, gymContext } =
    await request.json();

  if (!className) {
    return Response.json({ error: "Class name is required" }, { status: 400 });
  }

  const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

  const prompt = `You are a friendly staff member at ${gymName || "a boxing gym"}.
${gymContext ? `Gym context: ${gymContext}` : ""}

Write a short, warm follow-up email to send to students who attended today's class. Keep it under 120 words. Encourage them to book their next session. Sign off as "${gymName || "The Team"}".

Class details:
- Class: ${className}
- Instructor: ${instructor || "your instructor"}
- Date: ${date}
- Time: ${time || ""}
- Location: ${location || ""}

Write only the email body — no subject line, no explanation.`;

  const result = await model.generateContent(prompt);
  const body = result.response.text();
  const subject = `Great work in ${className} today!`;

  return Response.json({ subject, body });
}
