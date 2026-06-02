"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Button } from "@/components/ui";
import { listThreads, getThreadDetail, archiveThread } from "@/app/actions/threads";
import { cn } from "@/lib/utils";
import type { EmailThread } from "@/lib/types";
import { Mail, RefreshCw, X } from "lucide-react";
import { senderName } from "./utils";
import { ThreadView } from "./components/ThreadView";

// ─── Helpers ────────────────────────────────────────────────────────────────

// Gmail-style received timestamp: clock time for today, "Mon D" for the current
// year, and "M/D/YY" for older messages.
function formatReceived(dateStr: string | null): string {
  if (!dateStr) return "";
  const date = new Date(dateStr);
  const now = new Date();
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  if (sameDay) {
    return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  }
  if (date.getFullYear() === now.getFullYear()) {
    return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }
  return date.toLocaleDateString(undefined, { month: "numeric", day: "numeric", year: "2-digit" });
}

// ─── Main page ───────────────────────────────────────────────────────────────

const PAGE_SIZE = 50;

export default function InboxPage() {
  const [threads, setThreads] = useState<EmailThread[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<EmailThread | null>(null);
  const [loadingThreads, setLoadingThreads] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [hasMore, setHasMore] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [mobileView, setMobileView] = useState<"list" | "thread">("list");

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  const loadThreads = useCallback(async (lim: number) => {
    const data = await listThreads(lim);
    setThreads(data);
    setHasMore(data.length === lim);
    return data.length;
  }, []);

  // Load the current window whenever the limit grows (initial load + infinite
  // scroll). The first page shows the full-pane spinner; later pages show the
  // inline "loading more" row so the feed stays continuous.
  useEffect(() => {
    const initial = limit === PAGE_SIZE;
    if (initial) setLoadingThreads(true);
    else setLoadingMore(true);
    loadThreads(limit).finally(() => {
      setLoadingThreads(false);
      setLoadingMore(false);
    });
  }, [limit, loadThreads]);

  // Infinite scroll: when the bottom sentinel scrolls into view and more rows
  // may exist, grow the window. No buttons, no page breaks.
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !loadingMore && !loadingThreads) {
          setLimit((l) => l + PAGE_SIZE);
        }
      },
      { root: scrollRef.current, rootMargin: "300px" }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, loadingMore, loadingThreads, threads.length]);

  const handleSync = async () => {
    setSyncing(true);
    setSyncError(null);
    try {
      const res = await fetch("/api/gmail/sync", { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg = body?.error ?? `Sync failed (${res.status})`;
        console.error("[gmail/sync] failed", res.status, body);
        setSyncError(msg);
      } else {
        console.log("[gmail/sync] ok", body);
      }
      await loadThreads(limit);
    } catch (err) {
      console.error("[gmail/sync] network error", err);
      setSyncError(err instanceof Error ? err.message : "Network error");
    } finally {
      setSyncing(false);
    }
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
    await loadThreads(limit);
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
        {syncError && (
          <div className="px-4 py-2 bg-red-50 border-b border-red-200 text-sm text-red-700 flex items-start justify-between gap-2">
            <span className="flex-1">Sync error: {syncError}</span>
            <button
              onClick={() => setSyncError(null)}
              className="text-red-500 hover:text-red-700 flex-shrink-0"
              aria-label="Dismiss"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {loadingThreads ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="w-5 h-5 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : threads.length === 0 ? (
          <EmptyInbox onSync={handleSync} syncing={syncing} />
        ) : (
          <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto">
            {threads.map((thread) => {
              const unread = thread.status === "unread";
              return (
                <button
                  key={thread.id}
                  onClick={() => handleSelectThread(thread)}
                  className={cn(
                    "w-full text-left px-4 py-3 border-b border-surface-50 hover:bg-surface-50 transition-colors",
                    selectedId === thread.id && "bg-brand-50 border-l-2 border-l-brand-500"
                  )}
                >
                  <div className="flex items-baseline justify-between gap-2 mb-0.5">
                    <span
                      className={cn(
                        "text-sm truncate",
                        unread ? "font-semibold text-surface-900" : "font-normal text-surface-700"
                      )}
                    >
                      {senderName(thread)}
                    </span>
                    <span
                      className={cn(
                        "text-xs shrink-0",
                        unread ? "text-surface-600 font-medium" : "text-surface-400"
                      )}
                    >
                      {formatReceived(thread.last_message_at)}
                    </span>
                  </div>
                  <p
                    className={cn(
                      "text-sm truncate",
                      unread ? "font-medium text-surface-800" : "text-surface-600"
                    )}
                  >
                    {thread.subject || "(no subject)"}
                  </p>
                </button>
              );
            })}
            {/* Infinite-scroll trigger + loading row; keeps the feed continuous */}
            <div ref={sentinelRef} aria-hidden className="h-px" />
            {loadingMore && (
              <div className="flex justify-center py-4">
                <div className="w-4 h-4 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
              </div>
            )}
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
