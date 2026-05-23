import Link from "next/link";
import { ArrowLeft } from "lucide-react";

export default function PrivacyPolicyPage() {
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
          Privacy Policy
        </h1>
        <p className="text-sm text-surface-400 mb-10">
          Last updated: April 1, 2026
        </p>

        <div className="space-y-8 text-surface-700 leading-relaxed">
          <section>
            <h2 className="text-lg font-semibold text-surface-900 mb-3">
              1. Information We Collect
            </h2>
            <p>
              When you use ReplyPilot, we collect the information you provide
              during account creation (name, email, business name) and the
              responses you submit through the AI readiness assessment. We also
              collect basic usage data such as pages visited and time spent on
              each section.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-surface-900 mb-3">
              2. How We Use Your Information
            </h2>
            <p>We use your information to:</p>
            <ul className="list-disc pl-6 mt-2 space-y-1.5">
              <li>Generate your personalized AI readiness report</li>
              <li>Improve our assessment and recommendation engine</li>
              <li>Communicate with you about your account and our service</li>
              <li>Analyze aggregate trends to improve ReplyPilot</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-surface-900 mb-3">
              3. Data Storage &amp; Security
            </h2>
            <p>
              Your assessment data is currently stored locally in your browser.
              We do not transmit your assessment responses to external servers.
              Account information is protected using industry-standard security
              measures.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-surface-900 mb-3">
              4. Sharing Your Information
            </h2>
            <p>
              We do not sell, rent, or share your personal information with third
              parties for marketing purposes. We may share anonymized, aggregate
              data for research or product improvement.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-surface-900 mb-3">
              5. Your Rights
            </h2>
            <p>
              You can delete your account and all associated data at any time
              from the Settings page. You may also contact us to request a copy
              of your data or ask any privacy-related questions.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-surface-900 mb-3">
              6. Changes to This Policy
            </h2>
            <p>
              We may update this Privacy Policy from time to time. We will
              notify you of significant changes by posting a notice on our
              website. Continued use of ReplyPilot after changes constitutes
              acceptance of the updated policy.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-surface-900 mb-3">
              7. Contact
            </h2>
            <p>
              If you have questions about this Privacy Policy, please contact us
              at{" "}
              <a
                href="mailto:privacy@replypilot.ai"
                className="text-brand-600 hover:text-brand-700 underline underline-offset-2"
              >
                privacy@replypilot.ai
              </a>
              .
            </p>
          </section>
        </div>
      </div>
    </main>
  );
}
