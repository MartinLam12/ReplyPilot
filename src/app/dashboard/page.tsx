"use client";

import Link from "next/link";
import { Card, Button } from "@/components/ui";
import { useUser } from "@/lib/user-context";
import { Mail, CalendarCheck, ArrowRight, MessageSquare, Users } from "lucide-react";

export default function DashboardPage() {
  const { user } = useUser();
  const firstName = user.name ? user.name.split(" ")[0] : "there";

  return (
    <div className="p-4 md:p-8 max-w-4xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-surface-900">Welcome back, {firstName}</h1>
        <p className="text-surface-500 mt-1">What do you want to do today?</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card className="p-6 hover:border-brand-200 hover:shadow-soft transition-all">
          <div className="w-12 h-12 rounded-xl bg-brand-50 flex items-center justify-center mb-4">
            <MessageSquare className="w-6 h-6 text-brand-600" />
          </div>
          <h2 className="text-lg font-semibold text-surface-900 mb-2">Reply to an Email</h2>
          <p className="text-sm text-surface-500 mb-6 leading-relaxed">
            Paste an incoming inquiry and get an AI-drafted reply in seconds. Membership questions,
            pricing, scheduling — handled.
          </p>
          <Link href="/inbox">
            <Button icon={<ArrowRight className="w-4 h-4" />} className="w-full">
              Open Inbox Tool
            </Button>
          </Link>
        </Card>

        <Card className="p-6 hover:border-brand-200 hover:shadow-soft transition-all">
          <div className="w-12 h-12 rounded-xl bg-accent-50 flex items-center justify-center mb-4">
            <CalendarCheck className="w-6 h-6 text-accent-600" />
          </div>
          <h2 className="text-lg font-semibold text-surface-900 mb-2">Send Class Follow-Ups</h2>
          <p className="text-sm text-surface-500 mb-6 leading-relaxed">
            Log a class you just ran and generate follow-up emails for every attendee. Keep members
            engaged and coming back.
          </p>
          <Link href="/classes">
            <Button
              variant="secondary"
              icon={<ArrowRight className="w-4 h-4" />}
              className="w-full"
            >
              Log a Class
            </Button>
          </Link>
        </Card>
      </div>

      <div className="bg-surface-50 rounded-2xl p-6 border border-surface-100">
        <h3 className="font-semibold text-surface-900 mb-4">Quick tips</h3>
        <ul className="space-y-3 text-sm text-surface-600">
          <li className="flex items-start gap-3">
            <Mail className="w-4 h-4 text-brand-500 mt-0.5 shrink-0" />
            <span>
              <strong className="text-surface-800">Inbox tool:</strong> Paste the full email you
              received for the best AI reply. Include the sender&apos;s name if you have it.
            </span>
          </li>
          <li className="flex items-start gap-3">
            <Users className="w-4 h-4 text-brand-500 mt-0.5 shrink-0" />
            <span>
              <strong className="text-surface-800">Class follow-ups:</strong> Enter attendee emails
              one per line. The mailto link will pre-fill everything — you just hit send.
            </span>
          </li>
          <li className="flex items-start gap-3">
            <CalendarCheck className="w-4 h-4 text-brand-500 mt-0.5 shrink-0" />
            <span>
              <strong className="text-surface-800">Best time to send:</strong> Follow-up emails
              sent within 2 hours of class get the highest open rates.
            </span>
          </li>
        </ul>
      </div>
    </div>
  );
}
