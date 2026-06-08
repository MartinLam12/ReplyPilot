"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui";
import { Input } from "@/components/ui";
import { Turnstile } from '@marsidev/react-turnstile'

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [turnstileToken, setTurnstileToken] = useState("");
  const searchParams = useSearchParams();
  const registered = searchParams.get("registered") === "1";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const supabase = createClient();
      const { error: authError } = await supabase.auth.signInWithPassword({
        email,
        password,
        options: { captchaToken: turnstileToken }
      });
      if (authError) throw authError;
      window.location.href = "/dashboard";
    } catch {
      setError("Invalid email or password. Please try again.");
    } finally {
      setLoading(false);
    }
  };

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
          <h1 className="text-2xl font-bold text-surface-900">Welcome back</h1>
          <p className="text-surface-500 mt-1 text-sm">Sign in to your account</p>
        </div>

        <div className="bg-white rounded-2xl border border-surface-200 shadow-soft-sm p-6">
          {registered && (
            <div className="mb-4 p-3 bg-surface-100 border border-surface-200 rounded-xl text-sm text-surface-700">
              Account created — sign in to continue.
            </div>
          )}
          {error && (
            <div className="mb-4 p-3 bg-danger-50 border border-danger-200 rounded-xl text-sm text-danger-700">
              {error}
            </div>
          )}
          <form onSubmit={handleSubmit} className="space-y-4">
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
              autoComplete="current-password"
            />
            <Turnstile
              siteKey={process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY!}
              onSuccess={(token) => setTurnstileToken(token)}
            />
            <Button type="submit" loading={loading} className="w-full">
              Sign In
            </Button>
          </form>
        </div>

        <p className="text-center text-sm text-surface-500 mt-4">
          Don&apos;t have an account?{" "}
          <Link href="/signup" className="text-brand-600 font-medium hover:underline">
            Sign up
          </Link>
        </p>
      </div>
    </div>
  );
}