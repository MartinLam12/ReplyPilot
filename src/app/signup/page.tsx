"use client";

import { useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui";
import { Input } from "@/components/ui";
import { Turnstile } from '@marsidev/react-turnstile';

export default function SignupPage() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const supabase = createClient();
      const { error: authError } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: { name },
          captchaToken: turnstileToken,
        },
      });
      // "User already registered" reveals account existence — always show the
      // same confirmation screen so the email address cannot be enumerated.
      if (authError && authError.message !== "User already registered") {
        throw authError;
      }
      setDone(true);
    } catch (err) {
      setError(err instanceof Error && err.message
        ? "Something went wrong. Please try again."
        : "Failed to create account");
    } finally {
      setLoading(false);
    }
  };

  if (done) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4 bg-surface-50">
        <div className="w-full max-w-sm text-center">
          <div className="w-12 h-12 rounded-full bg-brand-100 flex items-center justify-center mx-auto mb-4">
            <span className="text-2xl">✓</span>
          </div>
          <h2 className="text-xl font-bold text-surface-900 mb-2">Check your email</h2>
          <p className="text-surface-500 text-sm">
            We sent a confirmation link to <strong>{email}</strong>. Click it to activate your account.
          </p>
          <Link href="/login" className="block mt-6 text-brand-600 text-sm font-medium hover:underline">
            Back to sign in
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 bg-surface-50">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <Link href="/" className="inline-flex items-center gap-2 mb-6">
            <div className="w-8 h-8 rounded-lg gradient-brand flex items-center justify-center">
              <span className="text-white font-bold text-sm">R</span>
            </div>
            <span className="text-lg font-bold text-surface-900">ReplyPilot</span>
          </Link>
          <h1 className="text-2xl font-bold text-surface-900">Create your account</h1>
          <p className="text-surface-500 mt-1 text-sm">Set up ReplyPilot for your gym</p>
        </div>

        <div className="bg-white rounded-2xl border border-surface-200 shadow-soft-sm p-6">
          {error && (
            <div className="mb-4 p-3 bg-danger-50 border border-danger-200 rounded-xl text-sm text-danger-700">
              {error}
            </div>
          )}
          <form onSubmit={handleSubmit} className="space-y-4">
            <Input
              label="Your Name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              autoComplete="name"
            />
            <Input
              label="Email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
            />
            <Input
              label="Password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="new-password"
              hint="At least 8 characters"
            />
            <Turnstile
              siteKey={process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY!}
              onSuccess={(token) => setTurnstileToken(token)}
            />
            <Button type="submit" loading={loading} className="w-full">
              Create Account
            </Button>
          </form>
        </div>

        <p className="text-center text-sm text-surface-500 mt-4">
          Already have an account?{" "}
          <Link href="/login" className="text-brand-600 font-medium hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}