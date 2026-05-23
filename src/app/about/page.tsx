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
            ReplyPilot was built with one mission: help small businesses navigate
            the AI landscape without the jargon, hype, or overwhelming complexity.
          </p>

          <h2 className="text-xl font-semibold text-surface-900 mt-10">
            Why We Exist
          </h2>
          <p>
            AI is transforming how businesses operate, but most resources are
            built for enterprises with dedicated tech teams and six-figure
            budgets. Small businesses deserve a clear, honest, and actionable
            path to adopting AI — one that starts where they actually are, not
            where a vendor wants them to be.
          </p>

          <h2 className="text-xl font-semibold text-surface-900 mt-10">
            What We Do
          </h2>
          <p>
            We guide small businesses through a structured assessment to
            understand their operations, challenges, and goals. Then we generate
            a tailored AI adoption report with prioritized recommendations,
            estimated impact, implementation difficulty, and concrete next steps.
          </p>
          <p>
            No generic advice. No one-size-fits-all playbooks. Every report is
            built from your actual business context.
          </p>

          <h2 className="text-xl font-semibold text-surface-900 mt-10">
            Our Approach
          </h2>
          <ul className="list-disc pl-6 space-y-2">
            <li>
              <strong>Practical over theoretical</strong> — We recommend tools
              you can implement this week, not next year.
            </li>
            <li>
              <strong>Honest about limitations</strong> — Not every business
              needs AI for everything. We tell you where it makes sense and where
              it doesn&apos;t.
            </li>
            <li>
              <strong>Built for real businesses</strong> — We understand that
              small businesses run on tight margins, small teams, and limited
              time.
            </li>
          </ul>

          <div className="mt-12 p-6 bg-brand-50 rounded-xl border border-brand-100">
            <p className="text-brand-800 font-medium">
              Ready to find your AI advantage?
            </p>
            <Link
              href="/assessment"
              className="inline-block mt-3 text-brand-600 font-semibold hover:text-brand-700 underline underline-offset-2"
            >
              Take the free assessment →
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
