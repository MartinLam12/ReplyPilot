import Link from "next/link";
import { ArrowLeft } from "lucide-react";

export default function AboutPage() {
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

        <h1 className="text-3xl font-bold text-surface-900 mb-6">
          About ReplyPilot
        </h1>

        <div className="prose prose-surface max-w-none space-y-6 text-surface-700 leading-relaxed">
          <p>
            ReplyPilot is an AI-assisted email reply tool built specifically for
            boxing and martial arts gym owners. It connects to your gym&apos;s Gmail,
            pulls in your inbox threads, and lets you send professional, on-brand
            replies with a single click.
          </p>

          <h2 className="text-xl font-semibold text-surface-900 mt-10">
            Why We Built It
          </h2>
          <p>
            Gym owners spend hours every week fielding the same questions —
            membership pricing, class schedules, trial offers. Every hour in the
            inbox is an hour not spent on the gym floor coaching members. We built
            ReplyPilot to give that time back.
          </p>

          <h2 className="text-xl font-semibold text-surface-900 mt-10">
            What It Does
          </h2>
          <p>
            Connect your Gmail account and ReplyPilot syncs your inbox. When an
            inquiry comes in, click &ldquo;Draft Reply&rdquo; and the AI writes a
            professional response that follows the reply rules you set — your
            pricing, your hours, your voice. Review it, tweak it if you like, and
            send it straight from Gmail.
          </p>
          <p>
            Over time, ReplyPilot learns your writing style from the feedback you
            give, so drafts get closer and closer to how you actually sound.
          </p>

          <h2 className="text-xl font-semibold text-surface-900 mt-10">
            Built For
          </h2>
          <ul className="list-disc pl-6 space-y-2">
            <li>
              <strong>Boxing and martial arts gyms</strong> — the reply rules,
              tone, and workflow are designed around how gym owners actually
              communicate with leads and members.
            </li>
            <li>
              <strong>Owner-operators</strong> — no dedicated office staff, no
              marketing team. Just you and your inbox.
            </li>
            <li>
              <strong>Multi-location gyms</strong> — manage emails across up to
              two gym locations from one dashboard.
            </li>
          </ul>

          <div className="mt-12 p-6 bg-brand-50 rounded-xl border border-brand-100">
            <p className="text-brand-800 font-medium">
              Ready to stop losing members to unanswered emails?
            </p>
            <Link
              href="/signup"
              className="inline-block mt-3 text-brand-600 font-semibold hover:text-brand-700 underline underline-offset-2"
            >
              Get started →
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
