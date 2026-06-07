"use client";

import { useState, useEffect } from "react";
import { Card, CardTitle, CardDescription, Button, Input, Textarea } from "@/components/ui";
import { getGymSettings, saveGymSettings, disconnectGmail } from "@/app/actions/gym-settings";
import { Save, Building2, Mail, CheckCircle2, AlertCircle, Sparkles, Plus, Trash2, XCircle, TriangleAlert } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { GymSettings } from "@/lib/types";

interface StyleSample {
  id: string;
  clean_body: string;
  word_count: number;
  context_cluster: string | null;
  created_at: string;
}

export default function SettingsPage() {
  const [settings, setSettings] = useState<GymSettings | null>(null);
  const [gymName, setGymName] = useState("");
  const [gymContext, setGymContext] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  // Style examples
  const [sampleCount, setSampleCount] = useState<number | null>(null);
  const [examples, setExamples] = useState<StyleSample[]>([]);
  const [exampleText, setExampleText] = useState("");
  const [addingExample, setAddingExample] = useState(false);
  const [exampleAdded, setExampleAdded] = useState(false);
  const [exampleError, setExampleError] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);

  const [subPeriodEnd, setSubPeriodEnd] = useState<string | null>(null);
  const [cancelConfirm, setCancelConfirm] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [cancelledUntil, setCancelledUntil] = useState<string | null>(null);
  const [cancelError, setCancelError] = useState<string | null>(null);

  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const loadExamples = () => {
    fetch("/api/style/samples")
      .then((r) => r.json())
      .then((d) => setExamples(d.samples ?? []))
      .catch(() => setExamples([]));
  };

  useEffect(() => {
    getGymSettings().then((s) => {
      if (s) {
        setSettings(s);
        setGymName(s.gym_name);
        setGymContext(s.gym_context);
      }
    });

    fetch("/api/style/status")
      .then((r) => r.json())
      .then((d) => setSampleCount(d.sampleCount ?? 0))
      .catch(() => setSampleCount(0));

    loadExamples();

    fetch("/api/stripe/cancel")
      .then((r) => r.json())
      .then((d) => setSubPeriodEnd(d.periodEnd ?? null))
      .catch(() => {});

    // Handle OAuth result query params
    const params = new URLSearchParams(window.location.search);
    if (params.get("connected") === "true") {
      getGymSettings().then(setSettings);
      window.history.replaceState({}, "", "/settings");
    }
  }, []);

  const handleAddExample = async () => {
    if (!exampleText.trim()) return;
    setAddingExample(true);
    setExampleError(null);

    let res: Response | null = null;
    try {
      res = await fetch("/api/style/add-sample", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: exampleText }),
      });
    } catch (err) {
      setAddingExample(false);
      setExampleError(`Network error: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }

    const data = await res.json().catch(() => null);
    setAddingExample(false);

    if (!res.ok || !data?.ok) {
      setExampleError(data?.error || `Save failed (HTTP ${res.status})`);
      return;
    }

    setExampleText("");
    setSampleCount(data.sampleCount);
    setExampleAdded(true);
    loadExamples();
    setTimeout(() => setExampleAdded(false), 3000);
  };

  const handleRemoveExample = async (id: string) => {
    setRemovingId(id);
    setExampleError(null);
    try {
      const res = await fetch(`/api/style/samples?id=${id}`, { method: "DELETE" });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setExampleError(data?.error || `Remove failed (HTTP ${res.status})`);
        return;
      }
      setExamples((prev) => prev.filter((e) => e.id !== id));
      setSampleCount(data.sampleCount);
    } catch (err) {
      setExampleError(`Network error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setRemovingId(null);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    await saveGymSettings(gymName, gymContext);
    // Also save any pending writing style example — users expect the page-level
    // Save button to commit everything on the page, not just the gym fields.
    if (exampleText.trim()) {
      await handleAddExample();
    }
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  const handleCancelSubscription = async () => {
    setCancelling(true);
    setCancelError(null);
    try {
      const res = await fetch("/api/stripe/cancel", { method: "POST" });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setCancelError(data?.error ?? "Could not cancel. Please try again.");
        return;
      }
      setCancelledUntil(data.periodEnd);
      setCancelConfirm(false);
    } catch {
      setCancelError("Network error. Please try again.");
    } finally {
      setCancelling(false);
    }
  };

  const handleDeleteAccount = async () => {
    setDeleting(true);
    setDeleteError(null);
    try {
      const res = await fetch("/api/account/delete", { method: "POST" });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setDeleteError(data?.error ?? "Could not delete account. Please try again.");
        return;
      }
      // Session is now invalid — sign out locally then redirect to home.
      const supabase = createClient();
      await supabase.auth.signOut().catch(() => {});
      window.location.href = "/";
    } catch {
      setDeleteError("Network error. Please try again.");
    } finally {
      setDeleting(false);
    }
  };

  const handleDisconnect = async () => {
    if (!confirm("Disconnect Gmail? You can reconnect any time.")) return;
    setDisconnecting(true);
    await disconnectGmail();
    setSettings((prev) => prev ? { ...prev, gmail_email: null, gmail_refresh_token: null } : null);
    setDisconnecting(false);
  };

  return (
    <div className="p-4 md:p-8 max-w-2xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-surface-900">Settings</h1>
        <p className="text-surface-500 mt-1">Configure your gym and Gmail connection</p>
      </div>

      {saved && (
        <div className="bg-success-50 border border-success-500/20 text-success-700 rounded-xl p-4 text-sm font-medium">
          Settings saved!
        </div>
      )}

      {/* Gym info */}
      <Card>
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-xl bg-brand-50 flex items-center justify-center">
            <Building2 className="w-5 h-5 text-brand-600" />
          </div>
          <div>
            <CardTitle>Gym Information</CardTitle>
            <CardDescription>Used to personalise every AI-generated reply</CardDescription>
          </div>
        </div>

        <div className="space-y-4">
          <Input
            label="Gym Name"
            value={gymName}
            onChange={(e) => setGymName(e.target.value)}
            placeholder="City Boxing Gym"
          />
          <Textarea
            label="Reply Rules"
            value={gymContext}
            onChange={(e) => setGymContext(e.target.value)}
            rows={5}
            placeholder={`Rules the AI must follow in every reply. For example:
- Two locations: Main St and West End
- Classes: Boxing, Muay Thai, Sparring
- Hours: Mon–Fri 6am–9pm, Sat–Sun 8am–6pm
- Membership: $120/month or $30 casual
- Always offer a free trial to new leads
- Never quote custom pricing — direct them to call`}
          />
          <p className="text-xs text-surface-400">
            The AI will follow these rules exactly when drafting every reply.
          </p>
        </div>
      </Card>

      {/* Style examples */}
      <Card>
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-xl bg-brand-50 flex items-center justify-center">
            <Sparkles className="w-5 h-5 text-brand-600" />
          </div>
          <div>
            <CardTitle>Writing Style Examples</CardTitle>
            <CardDescription>
              Paste emails you&apos;ve written so the AI learns your tone
              {sampleCount !== null && (
                <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-brand-50 text-brand-700">
                  {sampleCount} {sampleCount === 1 ? "example" : "examples"} saved
                </span>
              )}
            </CardDescription>
          </div>
        </div>

        <div className="space-y-3">
          <Textarea
            label="Paste an email you wrote"
            value={exampleText}
            onChange={(e) => setExampleText(e.target.value)}
            rows={6}
            placeholder={`Paste the body of an email you've sent before. For example:

Hey John,

Thanks for reaching out! We'd love to have you come in and try a class. We run boxing sessions Mon–Fri at 6pm and Saturday mornings at 9am.

Drop by any time or let me know what works and I'll get you booked in.

Coach Martin`}
          />
          <p className="text-xs text-surface-400">
            Add a few examples of how you typically write replies — the more you add, the better the drafts will sound like you.
          </p>

          {exampleAdded && (
            <div className="flex items-center gap-2 text-sm text-success-700 bg-success-50 border border-success-200 rounded-xl px-4 py-3">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              Example saved — style memory updated.
            </div>
          )}

          {exampleError && (
            <div className="flex items-start gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <div className="min-w-0 break-words">{exampleError}</div>
            </div>
          )}

          <Button
            onClick={handleAddExample}
            loading={addingExample}
            disabled={!exampleText.trim()}
            variant="secondary"
            icon={<Plus className="w-4 h-4" />}
          >
            Save Example
          </Button>

          {examples.length > 0 && (
            <div className="space-y-2 pt-4 border-t border-surface-100">
              <p className="text-xs font-medium text-surface-500">
                Your examples — the AI draws on these when drafting replies
              </p>
              {examples.map((ex) => (
                <div
                  key={ex.id}
                  className="flex items-start gap-3 p-3 rounded-xl border border-surface-200 bg-surface-50"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-surface-700 whitespace-pre-wrap line-clamp-3">
                      {ex.clean_body}
                    </p>
                    <p className="text-xs text-surface-400 mt-1">
                      {ex.word_count} words
                      {ex.context_cluster ? ` · ${ex.context_cluster.replace("_", " ")}` : ""}
                    </p>
                  </div>
                  <button
                    onClick={() => handleRemoveExample(ex.id)}
                    disabled={removingId === ex.id}
                    aria-label="Remove example"
                    className="shrink-0 text-surface-400 hover:text-red-600 disabled:opacity-40 transition-colors p-1"
                  >
                    {removingId === ex.id ? (
                      <div className="w-4 h-4 border-2 border-surface-300 border-t-transparent rounded-full animate-spin" />
                    ) : (
                      <Trash2 className="w-4 h-4" />
                    )}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </Card>

      {/* Gmail connection */}
      <Card>
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-xl bg-surface-100 flex items-center justify-center">
            <Mail className="w-5 h-5 text-surface-600" />
          </div>
          <div>
            <CardTitle>Gmail Connection</CardTitle>
            <CardDescription>Connect your gym&apos;s Gmail to read and send emails</CardDescription>
          </div>
        </div>

        {settings?.gmail_email ? (
          <div className="space-y-4">
            <div className="flex items-center gap-3 p-4 bg-success-50 border border-success-200 rounded-xl">
              <CheckCircle2 className="w-5 h-5 text-success-600 shrink-0" />
              <div className="min-w-0">
                <p className="text-sm font-medium text-success-800">Connected</p>
                <p className="text-sm text-success-700 truncate">{settings.gmail_email}</p>
              </div>
            </div>
            {settings.gmail_last_synced_at && (
              <p className="text-xs text-surface-400">
                Last synced: {new Date(settings.gmail_last_synced_at).toLocaleString()}
              </p>
            )}
            <Button
              variant="outline"
              size="sm"
              loading={disconnecting}
              onClick={handleDisconnect}
            >
              Disconnect Gmail
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-start gap-3 p-4 bg-surface-50 border border-surface-200 rounded-xl">
              <AlertCircle className="w-5 h-5 text-surface-400 shrink-0 mt-0.5" />
              <div className="text-sm text-surface-600">
                <p className="font-medium text-surface-800 mb-1">Gmail not connected</p>
                <p>Connect your gym&apos;s Gmail account to pull in incoming emails and send replies directly from ReplyPilot.</p>
              </div>
            </div>
            <a href="/api/gmail/auth">
              <Button icon={<Mail className="w-4 h-4" />}>
                Connect Gmail
              </Button>
            </a>
          </div>
        )}
      </Card>

      {/* Subscription — only shown when the user has an active subscription */}
      {subPeriodEnd && (
        <Card>
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 rounded-xl bg-surface-100 flex items-center justify-center">
              <XCircle className="w-5 h-5 text-surface-600" />
            </div>
            <div>
              <CardTitle>Subscription</CardTitle>
              <CardDescription>Manage your ReplyPilot subscription</CardDescription>
            </div>
          </div>

          {cancelledUntil ? (
            <div className="text-sm text-surface-700 bg-surface-50 border border-surface-200 rounded-xl p-4">
              Your subscription will end on {new Date(cancelledUntil).toLocaleDateString()}.
            </div>
          ) : cancelConfirm ? (
            <div className="space-y-3">
              <p className="text-sm text-surface-700">
                Are you sure? You&apos;ll keep access until{" "}
                <span className="font-medium">{new Date(subPeriodEnd).toLocaleDateString()}</span>.
              </p>
              {cancelError && (
                <div className="flex items-start gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  {cancelError}
                </div>
              )}
              <div className="flex gap-3">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCancelConfirm(false)}
                  disabled={cancelling}
                >
                  Keep subscription
                </Button>
                <Button
                  variant="danger"
                  size="sm"
                  loading={cancelling}
                  onClick={handleCancelSubscription}
                >
                  Yes, cancel
                </Button>
              </div>
            </div>
          ) : (
            <Button variant="outline" size="sm" onClick={() => setCancelConfirm(true)}>
              Cancel subscription
            </Button>
          )}
        </Card>
      )}

      <div className="flex justify-end">
        <Button onClick={handleSave} loading={saving} icon={<Save className="w-4 h-4" />}>
          Save Changes
        </Button>
      </div>

      {/* Danger zone */}
      <div className="border border-red-200 rounded-2xl p-6 space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-red-50 flex items-center justify-center shrink-0">
            <TriangleAlert className="w-5 h-5 text-red-600" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-red-700">Danger zone</h2>
            <p className="text-sm text-surface-500">
              Permanently delete your account and all associated data. This cannot be undone.
            </p>
          </div>
        </div>

        <div className="space-y-3">
          <p className="text-sm text-surface-700">
            Type <span className="font-mono font-semibold text-red-700">DELETE</span> to confirm:
          </p>
          <Input
            label=""
            value={deleteConfirm}
            onChange={(e) => {
              setDeleteConfirm(e.target.value);
              setDeleteError(null);
            }}
            placeholder="DELETE"
          />

          {deleteError && (
            <div className="flex items-start gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <div className="min-w-0 break-words">{deleteError}</div>
            </div>
          )}

          <Button
            variant="danger"
            size="sm"
            loading={deleting}
            disabled={deleteConfirm !== "DELETE"}
            onClick={handleDeleteAccount}
          >
            Delete my account
          </Button>
        </div>
      </div>
    </div>
  );
}
