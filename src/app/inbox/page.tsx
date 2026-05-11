"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Button, Badge } from "@/components/ui";
import { listThreads, getThreadDetail, archiveThread } from "@/app/actions/threads";
import { approveGeneration, rejectGeneration } from "@/app/actions/ai-generations";
import { cn } from "@/lib/utils";
import type { EmailThread, EmailMessage, AIGeneration, EmailClassification } from "@/lib/types";
import {
  Mail,
  RefreshCw,
  Archive,
  Send,
  AlertTriangle,
  ChevronLeft,
  Sparkles,
  X,
} from "lucide-react";

// ─── Helpers ────────────────────────────────────────────────────────────────

function cleanBody(text: string | null): string {
  if (!text) return "";

  let clean = text;
  // Strip HTML if present
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

  // Strip URL noise common in plain-text marketing emails
  clean = clean
    .replace(/\(\s*https?:\/\/[^\s)]{20,}\s*\)/g, "") // remove (https://...) patterns
    .split("\n")
    .filter((line) => {
      const t = line.trim();
      if (!t) return true;
      if (/^https?:\/\/\S+$/.test(t)) return false; // bare URL-only line
      if (t.length > 120 && /^https?:\/\//.test(t)) return false; // long tracking URL
      return true;
    })
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return clean;
}

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return "";
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function senderName(thread: EmailThread): string {
  if (thread.contact?.name) return thread.contact.name;
  if (thread.contact?.email) return thread.contact.email.split("@")[0];
  return "Unknown";
}

function statusBadge(status: EmailThread["status"]) {
  if (status === "replied") return <Badge variant="success">Replied</Badge>;
  if (status === "unread") return <Badge variant="brand">New</Badge>;
  return null;
}

const RISK_BANNER: Record<string, { bg: string; text: string }> = {
  high: {
    bg: "bg-danger-50 border-danger-200 text-danger-800",
    text: "This email may involve a complaint, billing issue, or cancellation. Please reply manually.",
  },
  medium: {
    bg: "bg-yellow-50 border-yellow-200 text-yellow-800",
    text: "Review this draft carefully before sending.",
  },
};

// ─── Main page ───────────────────────────────────────────────────────────────

export default function InboxPage() {
  const [threads, setThreads] = useState<EmailThread[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<EmailThread | null>(null);
  const [loadingThreads, setLoadingThreads] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [mobileView, setMobileView] = useState<"list" | "thread">("list");

  const loadThreads = useCallback(async () => {
    setLoadingThreads(true);
    const data = await listThreads();
    setThreads(data);
    setLoadingThreads(false);
  }, []);

  useEffect(() => {
    loadThreads();
  }, [loadThreads]);

  const handleSync = async () => {
    setSyncing(true);
    await fetch("/api/gmail/sync", { method: "POST" });
    await loadThreads();
    setSyncing(false);
  };

  const handleSelectThread = async (thread: EmailThread) => {
    setSelectedId(thread.id);
    setMobileView("thread");
    setDetail(null);
    const data = await getThreadDetail(thread.id);
    setDetail(data);
  };

  const handleArchive = async (threadId: string) => {
    await archiveThread(threadId);
    setThreads((prev) => prev.filter((t) => t.id !== threadId));
    if (selectedId === threadId) {
      setSelectedId(null);
      setDetail(null);
      setMobileView("list");
    }
  };

  const handleThreadUpdate = async () => {
    if (selectedId) {
      const data = await getThreadDetail(selectedId);
      setDetail(data);
    }
    await loadThreads();
  };

  return (
    <div className="flex h-[calc(100vh-4rem)] overflow-hidden">
      {/* Thread list */}
      <div className={cn(
        "w-full lg:w-80 xl:w-96 flex-shrink-0 border-r border-surface-100 bg-white flex flex-col",
        mobileView === "thread" && "hidden lg:flex"
      )}>
        <div className="p-4 border-b border-surface-100 flex items-center justify-between">
          <h1 className="text-lg font-bold text-surface-900">Inbox</h1>
          <Button
            variant="ghost"
            size="sm"
            loading={syncing}
            onClick={handleSync}
            icon={<RefreshCw className="w-4 h-4" />}
          >
            Sync
          </Button>
        </div>

        {loadingThreads ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="w-5 h-5 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : threads.length === 0 ? (
          <EmptyInbox onSync={handleSync} syncing={syncing} />
        ) : (
          <div className="flex-1 min-h-0 overflow-y-auto">
            {threads.map((thread) => (
              <button
                key={thread.id}
                onClick={() => handleSelectThread(thread)}
                className={cn(
                  "w-full text-left px-4 py-4 border-b border-surface-50 hover:bg-surface-50 transition-colors",
                  selectedId === thread.id && "bg-brand-50 border-l-2 border-l-brand-500"
                )}
              >
                <div className="flex items-start justify-between gap-2 mb-1">
                  <span className="font-medium text-surface-900 text-sm truncate">
                    {senderName(thread)}
                  </span>
                  <span className="text-xs text-surface-400 shrink-0">
                    {timeAgo(thread.last_message_at)}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm text-surface-600 truncate">{thread.subject}</p>
                  {statusBadge(thread.status)}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Thread detail */}
      <div className={cn(
        "flex-1 flex flex-col bg-surface-50 min-w-0",
        mobileView === "list" && "hidden lg:flex"
      )}>
        {!selectedId ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center p-8">
            <div className="w-16 h-16 rounded-2xl bg-brand-50 flex items-center justify-center mb-4">
              <Mail className="w-8 h-8 text-brand-400" />
            </div>
            <p className="text-surface-500 text-sm">Select an email to read and reply</p>
          </div>
        ) : !detail ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="w-5 h-5 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <ThreadView
            thread={detail}
            onArchive={handleArchive}
            onUpdate={handleThreadUpdate}
            onBack={() => setMobileView("list")}
          />
        )}
      </div>
    </div>
  );
}

// ─── Thread view ─────────────────────────────────────────────────────────────

function ThreadView({
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
  const [generateError, setGenerateError] = useState(false);
  const [classification, setClassification] = useState<EmailClassification | null>(null);
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
    setGenerateError(false);

    const res = await fetch("/api/ai/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ threadId: thread.id, subject: thread.subject, messages }),
    });

    // High-risk path returns plain JSON, not a stream
    if (!res.headers.get("content-type")?.includes("text/event-stream")) {
      const data = await res.json();
      setClassification(data.classification);
      setGeneration(data.generation);
      setDraftBody(data.body || "");
      setGenerating(false);
      return;
    }

    // Stream SSE chunks into the textarea progressively
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let gotText = false;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const payload = line.slice(6).trim();
          if (!payload) continue;

          try {
            const obj = JSON.parse(payload) as { type: string; classification?: EmailClassification; value?: string };
            if (obj.type === "meta") {
              if (obj.classification) setClassification(obj.classification);
            } else if (obj.type === "text" && obj.value) {
              setDraftBody((prev) => prev + obj.value);
              setGenerating(false);
              gotText = true;
            } else if (obj.type === "error") {
              setGenerateError(true);
            }
          } catch {
            // malformed chunk — skip
          }
        }
      }
    } catch {
      setGenerateError(true);
    } finally {
      setGenerating(false);
      if (!gotText) setGenerateError(true);
    }
  };

  const handleSend = async () => {
    if (!draftBody.trim() || !replyTo) return;
    setSending(true);

    await fetch("/api/gmail/send", {
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

    if (generation) {
      await approveGeneration(generation.id, draftBody, thread.id);
    }

    setSent(true);
    setSending(false);
    await onUpdate();
  };

  const handleReject = async () => {
    if (generation) await rejectGeneration(generation.id);
    setGeneration(null);
    setDraftBody("");
    setClassification(null);
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
      <div className="bg-white border-t border-surface-100 p-4">
        {sent ? (
          <div className="flex items-center gap-2 text-sm text-success-700 bg-success-50 border border-success-200 rounded-xl px-4 py-3">
            <span>✓</span>
            <span>Reply sent</span>
          </div>
        ) : (
          <ReplyPanel
            classification={classification}
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

// ─── HTML email iframe ────────────────────────────────────────────────────────

// Upgrade http:// image/background sources to https:// to avoid mixed-content
// blocking on our HTTPS deployment. Most CDNs support HTTPS at the same URL.
function upgradeHttpUrls(html: string): string {
  return html
    .replace(/(<img[^>]+\bsrc\s*=\s*["'])http:\/\//gi, "$1https://")
    .replace(/(<[^>]+\bbackground(?:-image)?\s*=\s*["'])http:\/\//gi, "$1https://")
    .replace(/url\(\s*["']?http:\/\//gi, "url(https://");
}

// Styles injected BEFORE email's own <style> so the email's styles still win.
// Hard limits only: image/table widths and word wrap.
const BASE_STYLES = `
<base target="_blank">
<meta name="color-scheme" content="light">
<style>
  img{max-width:100%!important;height:auto}
  table{max-width:100%!important}
  body{word-wrap:break-word;overflow-wrap:break-word}
</style>`;

// Runs inside the null-origin sandbox — reports height to parent via postMessage.
// Uses allow-scripts (no allow-same-origin) so it cannot touch parent DOM.
const HEIGHT_SCRIPT = `<script>
(function(){
  function h(){
    var s=Math.max(
      document.body?document.body.scrollHeight:0,
      document.documentElement?document.documentElement.scrollHeight:0
    );
    if(s>0)window.parent.postMessage({__cpEmailH:s},'*');
  }
  window.addEventListener('load',function(){
    h();
    var imgs=document.querySelectorAll('img'),n=imgs.length;
    if(!n)return;
    imgs.forEach(function(i){
      if(i.complete){if(!--n)h();}
      else{
        i.addEventListener('load',function(){if(!--n)h();},{once:true});
        i.addEventListener('error',function(){if(!--n)h();},{once:true});
      }
    });
  });
  setTimeout(h,800);
})();
<\/script>`;

function buildSrcDoc(raw: string): string {
  const upgraded = upgradeHttpUrls(raw);
  const inject = BASE_STYLES + HEIGHT_SCRIPT;

  if (/<html\b/i.test(upgraded)) {
    const result = upgraded.replace(/(<head[^>]*>)/i, `$1\n${inject}`);
    if (result !== upgraded) return result;
  }

  // Fragment — wrap in a minimal document
  return `<!DOCTYPE html><html><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
${inject}
<style>
  body{font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;
       margin:0;padding:16px;color:#333}
  a{color:#1a73e8}
</style>
</head><body>${upgraded}</body></html>`;
}

function EmailHtmlFrame({ html }: { html: string }) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const MIN_EMAIL_FRAME_HEIGHT = 530;
  const [height, setHeight] = useState(MIN_EMAIL_FRAME_HEIGHT);

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      // Verify the message is from this iframe, not some other frame on the page
      if (e.source !== iframeRef.current?.contentWindow) return;
      const h = e.data?.__cpEmailH;
      if (typeof h === "number" && h > 0) setHeight(h);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  return (
    <iframe
      ref={iframeRef}
      srcDoc={buildSrcDoc(html)}
      // allow-scripts: needed for JS-lazy-loaded images and height reporter
      // allow-popups: needed for target="_blank" links to open new tabs
      // allow-popups-to-escape-sandbox: opened tabs are normal (not re-sandboxed)
      // NO allow-same-origin: scripts run in null origin, cannot touch parent DOM
      sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"
      className="w-full border-0 block"
      style={{ height: Math.max(height, MIN_EMAIL_FRAME_HEIGHT) }}
      title="Email content"
    />
  );
}

// ─── Message bubble ───────────────────────────────────────────────────────────

function MessageBubble({ message }: { message: EmailMessage }) {
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

// ─── Reply panel ─────────────────────────────────────────────────────────────

function ReplyPanel({
  classification,
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
  classification: EmailClassification | null;
  generating: boolean;
  generateError: boolean;
  generation: AIGeneration | null;
  draftBody: string;
  setDraftBody: (v: string) => void;
  sending: boolean;
  onGenerate: () => void;
  onSend: () => void;
  onReject: () => void;
}) {
  const riskInfo = classification ? RISK_BANNER[classification.risk_level] : null;

  if (classification?.risk_level === "high") {
    return (
      <div className={cn("flex gap-3 p-4 rounded-xl border text-sm", riskInfo?.bg)}>
        <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
        <div>
          <p className="font-semibold mb-1">Manual reply needed</p>
          <p className="text-xs opacity-80">{riskInfo?.text}</p>
        </div>
      </div>
    );
  }

  if (!generation && !generating && !draftBody.trim()) {
    return (
      <div className="flex flex-col gap-2">
        {generateError && (
          <p className="text-xs text-danger-600">Failed to generate a draft. Try again.</p>
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
      {riskInfo && classification?.risk_level === "medium" && (
        <div className={cn("flex gap-2 px-3 py-2 rounded-xl border text-xs", riskInfo.bg)}>
          <span>⚠️</span>
          <span>{riskInfo.text}</span>
        </div>
      )}

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

// ─── Empty state ──────────────────────────────────────────────────────────────

function EmptyInbox({ onSync, syncing }: { onSync: () => void; syncing: boolean }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center text-center p-8">
      <div className="w-16 h-16 rounded-2xl bg-surface-100 flex items-center justify-center mb-4">
        <Mail className="w-8 h-8 text-surface-400" />
      </div>
      <p className="text-surface-700 font-medium mb-1">No emails yet</p>
      <p className="text-surface-400 text-sm mb-6">
        Connect Gmail in Settings, then sync to pull in your inbox.
      </p>
      <Button variant="outline" size="sm" onClick={onSync} loading={syncing} icon={<RefreshCw className="w-4 h-4" />}>
        Sync Now
      </Button>
    </div>
  );
}
