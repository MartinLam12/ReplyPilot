"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Card, Button, Badge } from "@/components/ui";
import { listThreads } from "@/app/actions/threads";
import { Mail, Users, CalendarCheck, ArrowRight, RefreshCw } from "lucide-react";
import type { EmailThread } from "@/lib/types";

export default function DashboardPage() {
  const [threads, setThreads] = useState<EmailThread[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    listThreads().then((data) => {
      setThreads(data);
      setLoading(false);
    });
  }, []);

  const unread = threads.filter((t) => t.status === "unread" || t.status === "pending_reply");
  const replied = threads.filter((t) => t.status === "replied");

  return (
    <div className="p-4 md:p-8 max-w-4xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-surface-900">Dashboard</h1>
        <p className="text-surface-500 mt-1">Here&apos;s what needs your attention today.</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
        <StatCard
          label="Waiting for reply"
          value={loading ? "—" : unread.length}
          highlight={unread.length > 0}
        />
        <StatCard label="Replied today" value={loading ? "—" : replied.length} />
        <StatCard label="Total threads" value={loading ? "—" : threads.length} />
      </div>

      {/* Unread threads */}
      {unread.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-base font-semibold text-surface-900">Needs a reply</h2>
            <Link href="/inbox" className="text-sm text-brand-600 hover:underline">View all</Link>
          </div>
          <div className="space-y-2">
            {unread.slice(0, 5).map((thread) => (
              <Link
                key={thread.id}
                href="/inbox"
                className="flex items-center justify-between gap-3 bg-white border border-surface-200 rounded-xl px-4 py-3 hover:border-brand-200 hover:shadow-soft transition-all"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-surface-900 truncate">
                    {thread.contact?.name || thread.contact?.email || "Unknown"}
                  </p>
                  <p className="text-xs text-surface-500 truncate">{thread.subject}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Badge variant="brand">New</Badge>
                  <ArrowRight className="w-4 h-4 text-surface-400" />
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Quick actions */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <QuickAction
          icon={<Mail className="w-6 h-6 text-brand-600" />}
          title="Check Inbox"
          description="Read emails and send AI-drafted replies"
          href="/inbox"
          label="Open Inbox"
          iconBg="bg-brand-50"
        />
        <QuickAction
          icon={<Users className="w-6 h-6 text-accent-600" />}
          title="Contacts"
          description="View leads, trial members, and active members"
          href="/contacts"
          label="View Contacts"
          iconBg="bg-accent-50"
          variant="secondary"
        />
        <QuickAction
          icon={<CalendarCheck className="w-6 h-6 text-success-600" />}
          title="Class Follow-Ups"
          description="Generate follow-up emails after class"
          href="/classes"
          label="Log a Class"
          iconBg="bg-success-50"
          variant="secondary"
        />
      </div>

      {/* Sync prompt if no threads */}
      {!loading && threads.length === 0 && (
        <div className="bg-brand-50 border border-brand-200 rounded-2xl p-6 text-center">
          <p className="text-brand-800 font-medium mb-1">Your inbox is empty</p>
          <p className="text-brand-700 text-sm mb-4">
            Connect Gmail in Settings and sync to start seeing emails here.
          </p>
          <div className="flex items-center justify-center gap-3">
            <Link href="/settings">
              <Button size="sm" variant="outline">Go to Settings</Button>
            </Link>
            <Link href="/inbox">
              <Button size="sm" icon={<RefreshCw className="w-4 h-4" />}>Sync Inbox</Button>
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, highlight }: { label: string; value: number | string; highlight?: boolean }) {
  return (
    <div className={`bg-white border rounded-xl px-4 py-4 ${highlight ? "border-brand-200 bg-brand-50" : "border-surface-200"}`}>
      <p className={`text-2xl font-bold mb-1 ${highlight ? "text-brand-700" : "text-surface-900"}`}>{value}</p>
      <p className="text-xs text-surface-500">{label}</p>
    </div>
  );
}

function QuickAction({
  icon,
  title,
  description,
  href,
  label,
  iconBg,
  variant = "primary",
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  href: string;
  label: string;
  iconBg: string;
  variant?: "primary" | "secondary";
}) {
  return (
    <Card className="p-5 hover:border-brand-200 hover:shadow-soft transition-all" hover>
      <div className={`w-11 h-11 rounded-xl ${iconBg} flex items-center justify-center mb-4`}>
        {icon}
      </div>
      <h3 className="font-semibold text-surface-900 mb-1">{title}</h3>
      <p className="text-sm text-surface-500 mb-4 leading-relaxed">{description}</p>
      <Link href={href}>
        <Button variant={variant === "secondary" ? "secondary" : "primary"} size="sm" icon={<ArrowRight className="w-4 h-4" />} className="w-full">
          {label}
        </Button>
      </Link>
    </Card>
  );
}
