"use client";

import { useState } from "react";
import { approveGeneration, rejectGeneration } from "@/app/actions/ai-generations";
import type { EmailThread, AIGeneration } from "@/lib/types";
import { ChevronLeft, Archive } from "lucide-react";
import { senderName } from "../utils";
import { MessageBubble } from "./MessageBubble";
import { ReplyPanel } from "./ReplyPanel";
import { StyleFeedback } from "./StyleFeedback";

// ─── Thread view ─────────────────────────────────────────────────────────────

export function ThreadView({
  thread,
  onArchive,
  onUpdate,
  onBack,
}: {
  thread: EmailThread;
  onArchive: (id: string) => void;
  onUpdate: () => Promise<void>;
  onBack: () => void;
}) {
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [draftBody, setDraftBody] = useState(thread.latest_generation?.generated_body || "");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(thread.latest_generation?.status === "sent");
  const [generation, setGeneration] = useState<AIGeneration | null>(
    thread.latest_generation || null
  );

  const messages = thread.messages || [];
  const lastInbound = [...messages].reverse().find((m) => m.direction === "inbound");
  const replyTo = thread.contact?.email || lastInbound?.from_email || "";

  const handleGenerate = async () => {
    setGenerating(true);
    setDraftBody("");
    setGenerateError(null);

    const res = await fetch("/api/ai/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ threadId: thread.id, subject: thread.subject, messages }),
    });

    const data = await res.json().catch(() => null);
    setGeneration(data?.generation ?? null);
    setDraftBody(data?.body || "");
    if (!res.ok || data?.error || !data?.body) {
      setGenerateError(
        (typeof data?.error === "string" && data.error) ||
          `Failed to generate a draft (HTTP ${res.status}). Try again.`
      );
    }
    setGenerating(false);
  };

  const handleSend = async () => {
    if (!draftBody.trim() || !replyTo) return;
    setSending(true);

    let sendOk = false;
    let sendErrorMsg: string | null = null;
    try {
      const res = await fetch("/api/gmail/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          threadId: thread.id,
          gmailThreadId: thread.gmail_thread_id,
          to: replyTo,
          subject: generation?.generated_subject || `Re: ${thread.subject}`,
          body: draftBody,
        }),
      });
      if (res.ok) {
        sendOk = true;
      } else {
        const data = await res.json().catch(() => null);
        sendErrorMsg =
          (typeof data?.error === "string" && data.error) ||
          `Failed to send email (HTTP ${res.status}). Try again.`;
      }
    } catch {
      sendErrorMsg = "Failed to reach the server. Check your connection.";
    }

    if (!sendOk) {
      setGenerateError(sendErrorMsg);
      setSending(false);
      return;
    }

    // Only record the send and trigger style learning after confirmed delivery.
    // A generation row only exists when one was loaded for this thread; pass it
    // when present so its status is updated, but learning fires either way.
    await approveGeneration(draftBody, thread.id, generation?.id ?? null);

    setSent(true);
    setSending(false);
    await onUpdate();
  };

  const handleReject = async () => {
    if (generation) await rejectGeneration(generation.id);
    setGeneration(null);
    setDraftBody("");
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="bg-white border-b border-surface-100 px-4 py-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <button onClick={onBack} className="lg:hidden p-1 text-surface-500 hover:text-surface-900">
            <ChevronLeft className="w-5 h-5" />
          </button>
          <div className="min-w-0">
            <p className="font-semibold text-surface-900 text-sm truncate">{thread.subject}</p>
            <p className="text-xs text-surface-500">{senderName(thread)} · {replyTo}</p>
          </div>
        </div>
        <button
          onClick={() => onArchive(thread.id)}
          className="p-2 text-surface-400 hover:text-surface-700 hover:bg-surface-100 rounded-lg transition-colors shrink-0"
          title="Archive"
        >
          <Archive className="w-4 h-4" />
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4">
        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}
      </div>

      {/* Reply panel */}
      <div className="bg-white border-t border-surface-100 p-4 space-y-2">
        {sent ? (
          <>
            <div className="flex items-center gap-2 text-sm text-success-700 bg-success-50 border border-success-200 rounded-xl px-4 py-3">
              <span>✓</span>
              <span>Reply sent</span>
            </div>
            {generation && <StyleFeedback generationId={generation.id} />}
          </>
        ) : (
          <ReplyPanel
            generating={generating}
            generateError={generateError}
            generation={generation}
            draftBody={draftBody}
            setDraftBody={setDraftBody}
            sending={sending}
            onGenerate={handleGenerate}
            onSend={handleSend}
            onReject={handleReject}
          />
        )}
      </div>
    </div>
  );
}
