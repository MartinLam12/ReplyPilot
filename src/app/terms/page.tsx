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
          Last updated: June 3, 2026
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
              ReplyPilot is an AI-powered email assistant. The service connects
              to your Gmail inbox, generates AI-drafted replies based on your
              custom rules and writing style, and provides a contacts CRM to
              manage your leads and contacts. AI-generated drafts are suggestions
              only — you are responsible for reviewing and approving any reply
              before it is sent.
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
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-surface-900 mb-3">
              5. Intellectual Property
            </h2>
            <p>
              All content, branding, and software associated with ReplyPilot are
              the property of ReplyPilot and are protected by applicable
              intellectual property laws. Email drafts generated for your account are
              yours to use and share.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-surface-900 mb-3">
              6. Billing and Cancellation
            </h2>
            <p>
              ReplyPilot is a subscription service billed at $5/month. You may
              cancel at any time by contacting us at{" "}
              <a
                href="mailto:martinlam16061@gmail.com"
                className="text-brand-600 hover:text-brand-700 underline underline-offset-2"
              >
                martinlam16061@gmail.com
              </a>
              . Cancellations
              take effect at the end of the current billing period. We do not
              offer refunds for partial billing periods.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-surface-900 mb-3">
              7. Gmail Data
            </h2>
            <p>
              ReplyPilot connects to your Gmail account via Google OAuth and
              requests the following scopes:
            </p>
            <ul className="list-disc pl-6 mt-2 space-y-1.5">
              <li>
                <strong>gmail.readonly</strong> — to read your emails so
                ReplyPilot can display them and generate AI-drafted replies.
              </li>
              <li>
                <strong>gmail.modify</strong> — to create and save draft replies
                to your Gmail Drafts folder on your behalf.
              </li>
            </ul>
            <p className="mt-3">
              Email content is processed temporarily to generate AI replies and
              is not stored long-term. We do not sell, share, or use your email
              data for advertising purposes. You may revoke Gmail access at any
              time through your Google account settings, which will immediately
              disable ReplyPilot&apos;s access to your inbox.
            </p>
            <p className="mt-3">
              ReplyPilot&apos;s use of information received from Google APIs
              complies with the{" "}
              <a
                href="https://developers.google.com/terms/api-services-user-data-policy"
                target="_blank"
                rel="noopener noreferrer"
                className="text-brand-600 hover:text-brand-700 underline underline-offset-2"
              >
                Google API Services User Data Policy
              </a>
              , including the Limited Use requirements.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-surface-900 mb-3">
              8. Limitation of Liability
            </h2>
            <p>
              ReplyPilot is provided &quot;as is&quot; without warranties of any
              kind. We are not liable for any direct, indirect, incidental, or
              consequential damages arising from your use of the service.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-surface-900 mb-3">
              9. Termination
            </h2>
            <p>
              We reserve the right to suspend or terminate your access to
              ReplyPilot at our discretion if you violate these terms. You may
              delete your account at any time through the Settings page. Upon
              account termination, your personal data will be deleted within 30
              days.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-surface-900 mb-3">
              10. Changes to Terms
            </h2>
            <p>
              We may modify these Terms of Service at any time. We will provide
              notice of material changes. Your continued use of ReplyPilot after
              changes are posted constitutes acceptance.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-surface-900 mb-3">
              11. Contact
            </h2>
            <p>
              Questions about these terms? Contact us at{" "}
              <a
                href="mailto:martinlam16061@gmail.com"
                className="text-brand-600 hover:text-brand-700 underline underline-offset-2"
              >
                martinlam16061@gmail.com
              </a>
              .
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-surface-900 mb-3">
              12. Governing Law
            </h2>
            <p>
              These Terms of Service and any disputes arising from your use of
              ReplyPilot shall be governed by and construed in accordance with
              the laws of the State of Washington, USA, without regard to its
              conflict of law provisions.
            </p>
          </section>
        </div>
      </div>
    </main>
  );
}
