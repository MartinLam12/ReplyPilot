"use client";

import { useState } from "react";
import { Button, Card, Input } from "@/components/ui";
import { Sparkles, Copy, Check, CalendarCheck, ExternalLink, Users } from "lucide-react";

interface Draft {
  subject: string;
  body: string;
}

const LOCATIONS = ["Main Location", "Second Location"];

export default function ClassesPage() {
  const [className, setClassName] = useState("");
  const [instructor, setInstructor] = useState("");
  const [date, setDate] = useState(new Date().toISOString().split("T")[0]);
  const [time, setTime] = useState("");
  const [location, setLocation] = useState(LOCATIONS[0]);
  const [attendeeEmails, setAttendeeEmails] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  const gymName =
    typeof window !== "undefined" ? localStorage.getItem("gym_name") || "" : "";
  const gymContext =
    typeof window !== "undefined" ? localStorage.getItem("gym_context") || "" : "";

  const handleGenerate = async () => {
    if (!className.trim()) {
      setError("Please enter the class name.");
      return;
    }
    setError("");
    setLoading(true);
    setDraft(null);

    try {
      const res = await fetch("/api/draft-followup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ className, instructor, date, time, location, gymName, gymContext }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to generate follow-up");
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
    const emails = attendeeEmails
      .split(/[\n,]+/)
      .map((e) => e.trim())
      .filter(Boolean)
      .join(",");
    const params = new URLSearchParams({
      bcc: emails,
      su: draft.subject,
      body: draft.body,
    });
    window.open(`https://mail.google.com/mail/?view=cm&fs=1&${params.toString()}`, "_blank");
  };

  const emailCount = attendeeEmails
    .split(/[\n,]+/)
    .map((e) => e.trim())
    .filter(Boolean).length;

  return (
    <div className="p-4 md:p-8 max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-surface-900">Class Follow-Up Tool</h1>
        <p className="text-surface-500 mt-1">
          Log a class and generate a follow-up email for every attendee.
        </p>
      </div>

      <Card className="p-5 space-y-4">
        <h2 className="font-semibold text-surface-900 flex items-center gap-2">
          <CalendarCheck className="w-4 h-4 text-surface-400" />
          Class details
        </h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-surface-700 mb-1">Class name</label>
            <Input
              value={className}
              onChange={(e) => setClassName(e.target.value)}
              placeholder="e.g. Beginner Boxing, Sparring, Fitness"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-surface-700 mb-1">Instructor</label>
            <Input
              value={instructor}
              onChange={(e) => setInstructor(e.target.value)}
              placeholder="e.g. Coach Mike"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-surface-700 mb-1">Date</label>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div>
            <label className="block text-sm font-medium text-surface-700 mb-1">Time</label>
            <Input
              type="time"
              value={time}
              onChange={(e) => setTime(e.target.value)}
            />
          </div>
          <div className="sm:col-span-2">
            <label className="block text-sm font-medium text-surface-700 mb-1">Location</label>
            <div className="flex gap-2">
              {LOCATIONS.map((loc) => (
                <button
                  key={loc}
                  onClick={() => setLocation(loc)}
                  className={`px-4 py-2 rounded-xl text-sm font-medium border transition-all ${
                    location === loc
                      ? "bg-brand-50 border-brand-300 text-brand-700"
                      : "bg-white border-surface-200 text-surface-600 hover:border-surface-300"
                  }`}
                >
                  {loc}
                </button>
              ))}
            </div>
          </div>
        </div>

        {error && <p className="text-sm text-danger-600">{error}</p>}

        <Button
          onClick={handleGenerate}
          loading={loading}
          icon={<Sparkles className="w-4 h-4" />}
          className="w-full"
        >
          {loading ? "Generating…" : "Generate Follow-Up Email"}
        </Button>
      </Card>

      {draft && (
        <>
          <Card className="p-5 space-y-4 border-brand-200">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-surface-900 flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-brand-500" />
                AI-drafted follow-up
              </h2>
              <Button
                size="sm"
                variant="outline"
                onClick={handleCopy}
                icon={copied ? <Check className="w-4 h-4 text-success-600" /> : <Copy className="w-4 h-4" />}
              >
                {copied ? "Copied" : "Copy"}
              </Button>
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
          </Card>

          <Card className="p-5 space-y-4">
            <h2 className="font-semibold text-surface-900 flex items-center gap-2">
              <Users className="w-4 h-4 text-surface-400" />
              Attendee emails
              {emailCount > 0 && (
                <span className="ml-1 text-xs bg-brand-50 text-brand-700 px-2 py-0.5 rounded-full">
                  {emailCount}
                </span>
              )}
            </h2>
            <textarea
              value={attendeeEmails}
              onChange={(e) => setAttendeeEmails(e.target.value)}
              placeholder={"student1@email.com\nstudent2@email.com\nstudent3@email.com"}
              className="w-full rounded-xl border border-surface-200 px-4 py-3 text-sm text-surface-900 placeholder:text-surface-400 focus:outline-none focus:ring-2 focus:ring-brand-300 resize-none h-32 font-mono"
            />
            <p className="text-xs text-surface-400">
              Enter one email per line (or comma-separated). Emails will be sent as BCC so attendees
              don&apos;t see each other&apos;s addresses.
            </p>
            <Button
              onClick={handleOpenInGmail}
              icon={<ExternalLink className="w-4 h-4" />}
              className="w-full"
              disabled={emailCount === 0}
            >
              {emailCount > 0
                ? `Open in Gmail — send to ${emailCount} attendee${emailCount !== 1 ? "s" : ""}`
                : "Add attendee emails to send"}
            </Button>
          </Card>
        </>
      )}
    </div>
  );
}
