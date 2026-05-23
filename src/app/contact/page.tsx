"use client";

import Link from "next/link";
import { ArrowLeft, Mail, MessageSquare } from "lucide-react";
import { Card } from "@/components/ui";

export default function ContactPage() {
  return (
    <main className="min-h-screen bg-surface-50">
      <div className="container-narrow py-16">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-sm text-surface-500 hover:text-brand-600 mb-8"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Home
        </Link>

        <h1 className="text-3xl font-bold text-surface-900 mb-2">
          Contact Us
        </h1>
        <p className="text-surface-500 mb-10">
          Have a question, suggestion, or just want to say hi? We&apos;d love to
          hear from you.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-12">
          <Card className="flex items-start gap-4">
            <div className="w-10 h-10 rounded-lg bg-brand-50 flex items-center justify-center shrink-0">
              <Mail className="w-5 h-5 text-brand-600" />
            </div>
            <div>
              <h3 className="font-semibold text-surface-900 mb-1">Email</h3>
              <p className="text-sm text-surface-500 mb-2">
                For general inquiries and support.
              </p>
              <a
                href="mailto:hello@replypilot.ai"
                className="text-sm font-medium text-brand-600 hover:text-brand-700"
              >
                hello@replypilot.ai
              </a>
            </div>
          </Card>

          <Card className="flex items-start gap-4">
            <div className="w-10 h-10 rounded-lg bg-brand-50 flex items-center justify-center shrink-0">
              <MessageSquare className="w-5 h-5 text-brand-600" />
            </div>
            <div>
              <h3 className="font-semibold text-surface-900 mb-1">Feedback</h3>
              <p className="text-sm text-surface-500 mb-2">
                Help us improve ReplyPilot.
              </p>
              <a
                href="mailto:feedback@replypilot.ai"
                className="text-sm font-medium text-brand-600 hover:text-brand-700"
              >
                feedback@replypilot.ai
              </a>
            </div>
          </Card>
        </div>

        <Card>
          <h2 className="text-lg font-semibold text-surface-900 mb-4">
            Send a Message
          </h2>
          <form className="space-y-4" onSubmit={(e) => e.preventDefault()}>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-surface-700 mb-1.5">
                  Name
                </label>
                <input
                  type="text"
                  className="w-full px-3 py-2 border border-surface-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
                  placeholder="Your name"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-surface-700 mb-1.5">
                  Email
                </label>
                <input
                  type="email"
                  className="w-full px-3 py-2 border border-surface-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
                  placeholder="you@example.com"
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-surface-700 mb-1.5">
                Message
              </label>
              <textarea
                rows={5}
                className="w-full px-3 py-2 border border-surface-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent resize-none"
                placeholder="How can we help?"
              />
            </div>
            <button
              type="submit"
              className="btn-primary"
            >
              Send Message
            </button>
          </form>
        </Card>
      </div>
    </main>
  );
}
