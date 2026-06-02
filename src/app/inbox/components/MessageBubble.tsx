"use client";

import type { EmailMessage } from "@/lib/types";
import { EmailHtmlFrame } from "./EmailHtmlFrame";

// ─── Helpers ────────────────────────────────────────────────────────────────

function cleanBody(text: string | null): string {
  if (!text) return "";

  let clean = text;
  if (text.trimStart().startsWith("<")) {
    clean = text
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>/gi, "\n\n")
      .replace(/<\/div>/gi, "\n")
      .replace(/<[^>]+>/g, "")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .trim();
  }

  clean = clean
    .replace(/\(\s*https?:\/\/[^\s)]{20,}\s*\)/g, "")
    .split("\n")
    .filter((line) => {
      const t = line.trim();
      if (!t) return true;
      if (/^https?:\/\/\S+$/.test(t)) return false;
      if (t.length > 120 && /^https?:\/\//.test(t)) return false;
      return true;
    })
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return clean;
}

// ─── Message bubble ───────────────────────────────────────────────────────────

export function MessageBubble({ message }: { message: EmailMessage }) {
  const isOutbound = message.direction === "outbound";
  const body = message.body_text || "";
  const isHtml = body.trimStart().startsWith("<");

  if (isOutbound) {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] rounded-2xl px-4 py-3 text-sm bg-brand-600 text-white rounded-br-sm">
          <p className="text-xs mb-1 font-medium text-brand-200">You</p>
          <p className="whitespace-pre-wrap leading-relaxed break-words">{cleanBody(body)}</p>
        </div>
      </div>
    );
  }

  if (isHtml) {
    return (
      <div>
        <p className="text-xs font-medium text-surface-400 px-1 mb-1">{message.from_email}</p>
        <div className="bg-white border border-surface-200 rounded-xl overflow-hidden">
          <EmailHtmlFrame html={body} />
        </div>
      </div>
    );
  }

  return (
    <div className="flex justify-start">
      <div className="max-w-[80%] rounded-2xl px-4 py-3 text-sm bg-white border border-surface-200 text-surface-800 rounded-bl-sm">
        <p className="text-xs mb-1 font-medium text-surface-400">{message.from_email}</p>
        <p className="whitespace-pre-wrap leading-relaxed break-words">{cleanBody(body)}</p>
      </div>
    </div>
  );
}
