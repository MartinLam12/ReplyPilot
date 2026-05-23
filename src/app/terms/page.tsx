import Link from "next/link";
import { ArrowLeft } from "lucide-react";

export default function TermsOfServicePage() {
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
          Terms of Service
        </h1>
        <p className="text-sm text-surface-400 mb-10">
          Last updated: April 1, 2026
        </p>

        <div className="space-y-8 text-surface-700 leading-relaxed">
          <section>
            <h2 className="text-lg font-semibold text-surface-900 mb-3">
              1. Acceptance of Terms
            </h2>
            <p>
              By accessing or using ReplyPilot, you agree to be bound by these
              Terms of Service. If you do not agree, please do not use the
              service.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-surface-900 mb-3">
              2. Description of Service
            </h2>
            <p>
              ReplyPilot provides an AI readiness assessment tool for small
              businesses. The service generates tailored reports with
              recommendations based on information you provide. Our
              recommendations are informational and should not be considered
              professional consulting advice.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-surface-900 mb-3">
              3. User Accounts
            </h2>
            <p>
              You are responsible for maintaining the confidentiality of your
              account credentials and for all activity under your account. You
              must provide accurate and complete information when creating an
              account.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-surface-900 mb-3">
              4. Acceptable Use
            </h2>
            <p>You agree not to:</p>
            <ul className="list-disc pl-6 mt-2 space-y-1.5">
              <li>
                Use the service for any unlawful purpose
              </li>
              <li>
                Attempt to gain unauthorized access to our systems
              </li>
              <li>
                Reproduce, duplicate, or resell any part of the service without
                express permission
              </li>
              <li>
                Submit false or misleading information in the assessment
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-surface-900 mb-3">
              5. Intellectual Property
            </h2>
            <p>
              All content, branding, and software associated with ReplyPilot are
              the property of ReplyPilot and are protected by applicable
              intellectual property laws. Reports generated for your business are
              yours to use and share.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-surface-900 mb-3">
              6. Limitation of Liability
            </h2>
            <p>
              ReplyPilot is provided &quot;as is&quot; without warranties of any
              kind. We are not liable for any direct, indirect, incidental, or
              consequential damages arising from your use of the service. Our
              recommendations are for informational purposes and do not
              guarantee specific business outcomes.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-surface-900 mb-3">
              7. Termination
            </h2>
            <p>
              We reserve the right to suspend or terminate your access to
              ReplyPilot at our discretion if you violate these terms. You may
              delete your account at any time through the Settings page.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-surface-900 mb-3">
              8. Changes to Terms
            </h2>
            <p>
              We may modify these Terms of Service at any time. We will provide
              notice of material changes. Your continued use of ReplyPilot after
              changes are posted constitutes acceptance.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-surface-900 mb-3">
              9. Contact
            </h2>
            <p>
              Questions about these terms? Contact us at{" "}
              <a
                href="mailto:legal@replypilot.ai"
                className="text-brand-600 hover:text-brand-700 underline underline-offset-2"
              >
                legal@replypilot.ai
              </a>
              .
            </p>
          </section>
        </div>
      </div>
    </main>
  );
}
