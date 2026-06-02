"use client";

import { Button } from "@/components/ui";
import { Sparkles, Send, X } from "lucide-react";
import type { AIGeneration } from "@/lib/types";

// ─── Reply panel ─────────────────────────────────────────────────────────────

export function ReplyPanel({
  generating,
  generateError,
  generation,
  draftBody,
  setDraftBody,
  sending,
  onGenerate,
  onSend,
  onReject,
}: {
  generating: boolean;
  generateError: string | null;
  generation: AIGeneration | null;
  draftBody: string;
  setDraftBody: (v: string) => void;
  sending: boolean;
  onGenerate: () => void;
  onSend: () => void;
  onReject: () => void;
}) {
  if (!generation && !generating && !draftBody.trim()) {
    return (
      <div className="flex flex-col gap-2">
        {generateError && (
          <p className="text-xs text-danger-600">{generateError}</p>
        )}
        <Button onClick={onGenerate} icon={<Sparkles className="w-4 h-4" />}>
          Suggest a Reply
        </Button>
      </div>
    );
  }

  if (generating && !draftBody) {
    return (
      <div className="flex items-center gap-2 text-sm text-surface-500">
        <div className="w-4 h-4 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
        Drafting reply…
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="relative">
        <textarea
          value={draftBody}
          onChange={(e) => setDraftBody(e.target.value)}
          rows={6}
          className="w-full px-3.5 py-2.5 rounded-xl border border-surface-300 bg-surface-50 text-surface-900 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500"
          placeholder="Edit your reply…"
        />
        {(generation || draftBody.trim()) && (
          <span className="absolute top-2 right-2 flex items-center gap-1 text-xs text-brand-500 bg-brand-50 px-1.5 py-0.5 rounded-md pointer-events-none">
            <Sparkles className="w-3 h-3" />
            AI draft
          </span>
        )}
      </div>

      <div className="flex items-center gap-2">
        <Button
          onClick={onSend}
          loading={sending}
          disabled={!draftBody.trim()}
          icon={<Send className="w-4 h-4" />}
        >
          Send Reply
        </Button>
        <Button variant="ghost" size="sm" onClick={onReject} icon={<X className="w-4 h-4" />}>
          Clear
        </Button>
      </div>
    </div>
  );
}
