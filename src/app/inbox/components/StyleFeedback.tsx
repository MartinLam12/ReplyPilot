"use client";

import { useState } from "react";

// ─── Style feedback ───────────────────────────────────────────────────────────
// Shown under the "Reply sent" confirmation. Two taps max.

type StyleRating = "good" | "wrong_style";

export function StyleFeedback({ generationId }: { generationId: string }) {
  const [done, setDone] = useState(false);

  const submit = async (rating: StyleRating) => {
    setDone(true); // optimistic — don't block on network
    await fetch("/api/style/feedback", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ generationId, rating }),
    }).catch(() => {/* silent */});
  };

  if (done) {
    return <p className="text-xs text-surface-400 text-center">Thanks — style memory updated</p>;
  }

  return (
    <div className="flex items-center justify-center gap-3">
      <p className="text-xs text-surface-400">Sound like you?</p>
      <button
        onClick={() => submit("good")}
        className="text-xs px-2.5 py-1 rounded-lg border border-success-200 text-success-700 hover:bg-success-50 transition-colors"
      >
        Yes
      </button>
      <button
        onClick={() => submit("wrong_style")}
        className="text-xs px-2.5 py-1 rounded-lg border border-surface-200 text-surface-500 hover:bg-surface-50 transition-colors"
      >
        No
      </button>
    </div>
  );
}
