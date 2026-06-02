"use client";

import { useState } from "react";
import type { EmailMessage } from "@/lib/types";
import { EmailHtmlFrame } from "./EmailHtmlFrame";
import { MoreHorizontal } from "lucide-react";

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

// Remove the quoted reply chain so each message shows only its new content,
// matching how Gmail collapses prior messages behind the "•••" toggle.
// Returns everything up to (but not including) the first quote marker.
function stripQuotedText(text: string): string {
  const lines = text.split("\n");
  const kept: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();

    // Gmail / Apple Mail attribution: "On <date>, <name> wrote:" — sometimes
    // wraps across up to three lines but always ends in "wrote:".
    if (/^On\b/.test(t)) {
      const joined = [t, lines[i + 1]?.trim() ?? "", lines[i + 2]?.trim() ?? ""].join(" ");
      if (/\bwrote:\s*$/.test(t) || /\bwrote:\s*$/.test(joined)) break;
    }

    // Forwarded / original-message separators
    if (/^-{2,}\s*(original|forwarded)\s+message\s*-{2,}/i.test(t)) break;

    // Outlook reply divider (a run of underscores) followed by a header block
    if (/^_{5,}$/.test(t)) break;

    // Outlook header block: "From: …" immediately above Sent/To/Subject lines
    if (/^From:\s.+/.test(t)) {
      const ahead = lines.slice(i, i + 5).map((l) => l.trim()).join("\n");
      if (/(^|\n)(Sent|To|Subject):/.test(ahead)) break;
    }

    // Plain-text quoted lines
    if (t.startsWith(">")) break;

    kept.push(lines[i]);
  }

  return kept.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

// HTML equivalent of stripQuotedText: cut the markup at the first quoted-reply
// container so an HTML message shows only its new content. Mail clients wrap
// quotes in recognisable elements — Gmail uses `gmail_quote`/`gmail_attr`,
// others use <blockquote>. Truncating leaves dangling tags, which the iframe's
// browser parser auto-closes; this never weakens the sandbox.
function stripQuotedHtml(html: string): string {
  const markers = [
    /<div[^>]*class="[^"]*gmail_quote/i, // Gmail quote container
    /<div[^>]*class="[^"]*gmail_attr/i,  // Gmail "On … wrote:" attribution
    /<blockquote[^>]*>/i,                // Apple Mail / generic cite blocks
  ];
  let cut = -1;
  for (const re of markers) {
    const m = re.exec(html);
    if (m && (cut === -1 || m.index < cut)) cut = m.index;
  }
  return cut === -1 ? html : html.slice(0, cut);
}

// ─── Message bubble ───────────────────────────────────────────────────────────

export function MessageBubble({ message }: { message: EmailMessage }) {
  const [showQuoted, setShowQuoted] = useState(false);

  const isOutbound = message.direction === "outbound";
  const body = message.body_text || "";
  const isHtml = body.trimStart().startsWith("<");

  // Inbound HTML renders in the sandboxed iframe with the email's own layout.
  if (!isOutbound && isHtml) {
    const strippedHtml = stripQuotedHtml(body);
    const htmlHasQuoted = strippedHtml.length < body.length;
    const htmlToShow = showQuoted ? body : strippedHtml;
    return (
      <div>
        <p className="text-xs font-medium text-surface-400 px-1 mb-1">{message.from_email}</p>
        <div className="bg-white border border-surface-200 rounded-xl overflow-hidden">
          <EmailHtmlFrame
            key={showQuoted ? "full" : "collapsed"}
            html={htmlToShow}
            minHeight={htmlHasQuoted && !showQuoted ? 96 : undefined}
          />
        </div>
        {htmlHasQuoted && (
          <button
            onClick={() => setShowQuoted((v) => !v)}
            aria-label={showQuoted ? "Hide quoted text" : "Show quoted text"}
            title={showQuoted ? "Hide quoted text" : "Show quoted text"}
            className="mt-1.5 inline-flex items-center justify-center h-5 px-1.5 rounded bg-surface-200 text-surface-500 hover:bg-surface-300"
          >
            <MoreHorizontal className="w-4 h-4" />
          </button>
        )}
      </div>
    );
  }

  const cleaned = cleanBody(body);
  const visible = stripQuotedText(cleaned);
  const hasQuoted = visible.length < cleaned.length;
  const display = showQuoted ? cleaned : visible;

  const toggle = hasQuoted && (
    <button
      onClick={() => setShowQuoted((v) => !v)}
      aria-label={showQuoted ? "Hide quoted text" : "Show quoted text"}
      title={showQuoted ? "Hide quoted text" : "Show quoted text"}
      className={
        "mt-1.5 inline-flex items-center justify-center h-5 px-1.5 rounded " +
        (isOutbound
          ? "bg-white/20 text-brand-100 hover:bg-white/30"
          : "bg-surface-200 text-surface-500 hover:bg-surface-300")
      }
    >
      <MoreHorizontal className="w-4 h-4" />
    </button>
  );

  if (isOutbound) {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] rounded-2xl px-4 py-3 text-sm bg-brand-600 text-white rounded-br-sm">
          <p className="text-xs mb-1 font-medium text-brand-200">You</p>
          <p className="whitespace-pre-wrap leading-relaxed break-words">{display}</p>
          {toggle}
        </div>
      </div>
    );
  }

  return (
    <div className="flex justify-start">
      <div className="max-w-[80%] rounded-2xl px-4 py-3 text-sm bg-white border border-surface-200 text-surface-800 rounded-bl-sm">
        <p className="text-xs mb-1 font-medium text-surface-400">{message.from_email}</p>
        <p className="whitespace-pre-wrap leading-relaxed break-words">{display}</p>
        {toggle}
      </div>
    </div>
  );
}
