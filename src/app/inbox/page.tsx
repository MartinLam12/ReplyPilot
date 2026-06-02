"use client";

import { useState, useEffect, useCallback } from "react";
import { Button, Badge } from "@/components/ui";
import { listThreads, getThreadDetail, archiveThread } from "@/app/actions/threads";
import { cn } from "@/lib/utils";
import type { EmailThread } from "@/lib/types";
import { Mail, RefreshCw, X } from "lucide-react";
import { senderName } from "./utils";
import { ThreadView } from "./components/ThreadView";

// ─── Helpers ────────────────────────────────────────────────────────────────

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return "";
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function statusBadge(status: EmailThread["status"]) {
  if (status === "replied") return <Badge variant="success">Replied</Badge>;
  if (status === "unread") return <Badge variant="brand">New</Badge>;
  return null;
}

// ─── Main page ───────────────────────────────────────────────────────────────

const PAGE_SIZE = 50;

export default function InboxPage() {
  const [threads, setThreads] = useState<EmailThread[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<EmailThread | null>(null);
  const [loadingThreads, setLoadingThreads] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [pageSize, setPageSize] = useState(PAGE_SIZE);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [mobileView, setMobileView] = useState<"list" | "thread">("list");

  const loadThreads = useCallback(async (limit: number) => {
    const data = await listThreads(limit);
    setThreads(data);
    return data.length;
  }, []);

  useEffect(() => {
    setLoadingThreads(true);
    loadThreads(PAGE_SIZE).finally(() => setLoadingThreads(false));
  }, [loadThreads]);

  const handleShowMore = async () => {
    const next = pageSize + PAGE_SIZE;
    setLoadingMore(true);
    try {
      const returned = await loadThreads(next);
      setPageSize(returned < next ? returned : next);
    } finally {
      setLoadingMore(false);
    }
  };

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
      await loadThreads(pageSize);
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
    await loadThreads(pageSize);
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
            {threads.length >= pageSize && (
              <div className="p-3 border-b border-surface-50">
                <Button
                  variant="ghost"
                  size="sm"
                  loading={loadingMore}
                  onClick={handleShowMore}
                  className="w-full"
                >
                  Show more
                </Button>
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
