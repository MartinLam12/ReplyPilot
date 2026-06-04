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
          Last updated: June 4, 2026
        </p>

        <div className="space-y-8 text-surface-700 leading-relaxed">
          <section>
            <h2 className="text-lg font-semibold text-surface-900 mb-3">
              1. Overview
            </h2>
            <p>
              ReplyPilot is an AI-powered email reply tool built for gym owners.
              It connects to your Gmail account, uses Google Gemini to generate
              AI-drafted replies, and includes a contacts CRM to help you manage
              leads and members. This Privacy Policy explains what data we
              collect, how we use it, and how we protect it.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-surface-900 mb-3">
              2. Information We Collect
            </h2>
            <ul className="list-disc pl-6 mt-2 space-y-1.5">
              <li>
                <strong>Account information</strong> — your email address and
                password (stored securely via Supabase Auth).
              </li>
              <li>
                <strong>Billing information</strong> — your Stripe customer ID
                and subscription status. We never store raw card details; all
                payment data is handled directly by Stripe.
              </li>
              <li>
                <strong>Gmail data</strong> — email content and metadata
                fetched through the Gmail API to display your inbox and generate
                AI-drafted replies. See Section 4 for full details.
              </li>
              <li>
                <strong>Usage and logs</strong> — basic activity logs (e.g.
                when replies are generated or sent) used to operate and improve
                the service.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-surface-900 mb-3">
              3. How We Use Your Information
            </h2>
            <p>We use the information we collect to:</p>
            <ul className="list-disc pl-6 mt-2 space-y-1.5">
              <li>Operate and deliver the ReplyPilot service.</li>
              <li>
                Generate AI-drafted replies by passing email content to Google
                Gemini.
              </li>
              <li>
                Process payments and manage your subscription through Stripe.
              </li>
              <li>
                Send transactional emails (e.g. account confirmations, billing
                receipts).
              </li>
              <li>Diagnose issues and improve the service over time.</li>
            </ul>
            <p className="mt-3">
              We do not sell your data to third parties or use it for
              advertising purposes.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-surface-900 mb-3">
              4. Gmail Data and Google API Services
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
              data for advertising purposes.
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
            <p className="mt-3">
              You may revoke Gmail access at any time through{" "}
              <a
                href="https://myaccount.google.com/permissions"
                target="_blank"
                rel="noopener noreferrer"
                className="text-brand-600 hover:text-brand-700 underline underline-offset-2"
              >
                your Google account permissions
              </a>
              . Revoking access immediately disables ReplyPilot&apos;s
              connection to your inbox.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-surface-900 mb-3">
              5. Data Retention
            </h2>
            <p>
              We retain your account and billing data for as long as your
              account is active. If you delete your account, your personal data
              is removed within 30 days. Email content fetched from Gmail is not
              stored beyond the duration of the request that requires it.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-surface-900 mb-3">
              6. Data Sharing
            </h2>
            <p>
              We do not sell your personal data. We share data only with the
              following third-party services that are necessary to operate
              ReplyPilot:
            </p>
            <ul className="list-disc pl-6 mt-2 space-y-1.5">
              <li>
                <strong>Supabase</strong> — database and authentication.
              </li>
              <li>
                <strong>Stripe</strong> — payment processing and subscription
                management.
              </li>
              <li>
                <strong>Google Gemini</strong> — AI reply generation. Email
                content is passed to Gemini solely to produce draft replies.
              </li>
              <li>
                <strong>Vercel</strong> — application hosting and
                infrastructure.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-surface-900 mb-3">
              7. Security
            </h2>
            <p>
              All data is transmitted over HTTPS. Your database is protected by
              row-level security policies so that each user can only access their
              own data. Credentials and API keys are stored as restricted
              environment variables and are never exposed to the client. While we
              take reasonable precautions, no system is completely secure and we
              cannot guarantee absolute security.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-surface-900 mb-3">
              8. Your Rights
            </h2>
            <p>You have the right to:</p>
            <ul className="list-disc pl-6 mt-2 space-y-1.5">
              <li>Access the personal data we hold about you.</li>
              <li>Request correction of inaccurate data.</li>
              <li>Request deletion of your account and associated data.</li>
              <li>
                Revoke Gmail access at any time via{" "}
                <a
                  href="https://myaccount.google.com/permissions"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-brand-600 hover:text-brand-700 underline underline-offset-2"
                >
                  your Google account permissions
                </a>
                .
              </li>
            </ul>
            <p className="mt-3">
              To exercise any of these rights, contact us at{" "}
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
              9. Changes to This Policy
            </h2>
            <p>
              We may update this Privacy Policy from time to time. When we make
              material changes, we will update the &quot;Last updated&quot; date
              at the top of this page. Your continued use of ReplyPilot after
              changes are posted constitutes your acceptance of the revised
              policy.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-surface-900 mb-3">
              10. Contact
            </h2>
            <p>
              Questions about this Privacy Policy? Contact us at{" "}
              <a
                href="mailto:martinlam16061@gmail.com"
                className="text-brand-600 hover:text-brand-700 underline underline-offset-2"
              >
                martinlam16061@gmail.com
              </a>
              .
            </p>
          </section>
        </div>
      </div>
    </main>
  );
}
