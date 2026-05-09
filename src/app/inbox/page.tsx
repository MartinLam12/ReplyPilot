"use client";

import { useState } from "react";
import { Button, Card, Input } from "@/components/ui";
import { Sparkles, Copy, Check, Mail, ExternalLink, ChevronDown, ChevronUp } from "lucide-react";

interface Draft {
  subject: string;
  body: string;
}

export default function InboxPage() {
  const [fromEmail, setFromEmail] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [gymName, setGymName] = useState(() =>
    typeof window !== "undefined" ? localStorage.getItem("gym_name") || "" : ""
  );
  const [gymContext, setGymContext] = useState(() =>
    typeof window !== "undefined" ? localStorage.getItem("gym_context") || "" : ""
  );
  const [showSettings, setShowSettings] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  const saveSettings = () => {
    localStorage.setItem("gym_name", gymName);
    localStorage.setItem("gym_context", gymContext);
    setShowSettings(false);
  };

  const handleDraft = async () => {
    if (!body.trim()) {
      setError("Please paste the email you received.");
      return;
    }
    setError("");
    setLoading(true);
    setDraft(null);

    try {
      const res = await fetch("/api/draft-reply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fromEmail, subject, body, gymName, gymContext }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to draft reply");
      setDraft(data);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Something went wrong. Try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = () => {
    if (!draft) return;
    navigator.clipboard.writeText(draft.body);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleOpenInGmail = () => {
    if (!draft) return;
    const params = new URLSearchParams({
      to: fromEmail,
      su: draft.subject,
      body: draft.body,
    });
    window.open(`https://mail.google.com/mail/?view=cm&fs=1&${params.toString()}`, "_blank");
  };

  return (
    <div className="p-4 md:p-8 max-w-3xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-surface-900">Email Reply Tool</h1>
          <p className="text-surface-500 mt-1">Paste an incoming email and get an AI-drafted reply.</p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setShowSettings(!showSettings)}
          icon={showSettings ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        >
          Gym settings
        </Button>
      </div>

      {showSettings && (
        <Card className="p-5 space-y-4 border-brand-200 bg-brand-50/30">
          <p className="text-sm font-medium text-surface-700">
            These details are used to personalise every reply.
          </p>
          <div>
            <label className="block text-sm font-medium text-surface-700 mb-1">Gym name</label>
            <Input
              value={gymName}
              onChange={(e) => setGymName(e.target.value)}
              placeholder="e.g. Corner Boxing"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-surface-700 mb-1">
              Extra context <span className="text-surface-400 font-normal">(optional)</span>
            </label>
            <textarea
              value={gymContext}
              onChange={(e) => setGymContext(e.target.value)}
              placeholder="e.g. We have two locations in Brooklyn and Queens. Classes run Mon–Sat. Membership starts at $120/month."
              className="w-full rounded-xl border border-surface-200 px-4 py-3 text-sm text-surface-900 placeholder:text-surface-400 focus:outline-none focus:ring-2 focus:ring-brand-300 resize-none h-24"
            />
          </div>
          <Button size="sm" onClick={saveSettings}>Save settings</Button>
        </Card>
      )}

      <Card className="p-5 space-y-4">
        <h2 className="font-semibold text-surface-900 flex items-center gap-2">
          <Mail className="w-4 h-4 text-surface-400" />
          Incoming email
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-surface-700 mb-1">From</label>
            <Input
              value={fromEmail}
              onChange={(e) => setFromEmail(e.target.value)}
              placeholder="sender@email.com"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-surface-700 mb-1">Subject</label>
            <Input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Membership inquiry"
            />
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-surface-700 mb-1">Email body</label>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Paste the full email you received here..."
            className="w-full rounded-xl border border-surface-200 px-4 py-3 text-sm text-surface-900 placeholder:text-surface-400 focus:outline-none focus:ring-2 focus:ring-brand-300 resize-none h-40"
          />
        </div>
        {error && <p className="text-sm text-danger-600">{error}</p>}
        <Button
          onClick={handleDraft}
          loading={loading}
          icon={<Sparkles className="w-4 h-4" />}
          className="w-full"
        >
          {loading ? "Drafting reply…" : "Draft Reply"}
        </Button>
      </Card>

      {draft && (
        <Card className="p-5 space-y-4 border-brand-200">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-surface-900 flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-brand-500" />
              AI-drafted reply
            </h2>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={handleCopy} icon={copied ? <Check className="w-4 h-4 text-success-600" /> : <Copy className="w-4 h-4" />}>
                {copied ? "Copied" : "Copy"}
              </Button>
              <Button size="sm" onClick={handleOpenInGmail} icon={<ExternalLink className="w-4 h-4" />}>
                Open in Gmail
              </Button>
            </div>
          </div>
          <div>
            <p className="text-xs text-surface-400 uppercase font-medium mb-1">Subject</p>
            <p className="text-sm font-medium text-surface-800 bg-surface-50 rounded-lg px-3 py-2">
              {draft.subject}
            </p>
          </div>
          <div>
            <p className="text-xs text-surface-400 uppercase font-medium mb-1">Body</p>
            <textarea
              value={draft.body}
              onChange={(e) => setDraft({ ...draft, body: e.target.value })}
              className="w-full rounded-xl border border-surface-200 px-4 py-3 text-sm text-surface-900 focus:outline-none focus:ring-2 focus:ring-brand-300 resize-none h-48"
            />
          </div>
          <p className="text-xs text-surface-400">
            Edit the reply above before sending. Click &quot;Open in Gmail&quot; to send it directly.
          </p>
        </Card>
      )}
    </div>
  );
}
