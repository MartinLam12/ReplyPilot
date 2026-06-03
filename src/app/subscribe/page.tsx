"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui";

export default function SubscribePage() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubscribe() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/stripe/checkout", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Checkout failed");
      window.location.href = data.url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 bg-surface-50">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <Link href="/" className="inline-flex items-center gap-2 mb-6">
            <div className="w-8 h-8 rounded-lg gradient-brand flex items-center justify-center">
              <span className="text-white font-bold text-sm">R</span>
            </div>
            <span className="text-lg font-bold text-surface-900">ReplyPilot</span>
          </Link>
          <h1 className="text-2xl font-bold text-surface-900">
            Subscribe to ReplyPilot
          </h1>
          <p className="text-surface-500 mt-2 text-sm">
            Your subscription is required to access the app.
          </p>
        </div>

        <div className="bg-white rounded-2xl border border-surface-200 shadow-soft-sm p-8 space-y-6">
          <ul className="space-y-3 text-sm text-surface-700">
            <li className="flex items-start gap-2">
              <span className="text-brand-500 font-bold mt-0.5">✓</span>
              AI-powered email reply drafts tailored to your style
            </li>
            <li className="flex items-start gap-2">
              <span className="text-brand-500 font-bold mt-0.5">✓</span>
              Automated follow-up scheduling for leads and members
            </li>
            <li className="flex items-start gap-2">
              <span className="text-brand-500 font-bold mt-0.5">✓</span>
              Gmail inbox sync with smart contact tracking
            </li>
            <li className="flex items-start gap-2">
              <span className="text-brand-500 font-bold mt-0.5">✓</span>
              Unlimited drafts and replies every month
            </li>
          </ul>

          {error && (
            <div className="p-3 bg-danger-50 border border-danger-200 rounded-xl text-sm text-danger-700">
              {error}
            </div>
          )}

          <Button
            onClick={handleSubscribe}
            disabled={loading}
            className="w-full"
          >
            {loading ? "Redirecting to checkout…" : "Subscribe — monthly billing"}
          </Button>

          <p className="text-xs text-center text-surface-400">
            Payments are handled securely by Stripe. Cancel any time.
          </p>
        </div>
      </div>
    </div>
  );
}
