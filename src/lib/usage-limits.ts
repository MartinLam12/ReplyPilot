/**
 * Per-user daily caps on billed Gemini endpoints.
 *
 * Soft ceiling that protects against a runaway client or UI bug — the hard
 * ceiling lives on the GCP billing account itself, which this code cannot
 * reach. Counters are tracked in usage_counters via the increment_usage RPC.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export type UsageKind = "generate" | "add_sample";

// Conservative defaults sized for a single trusted client. Bump per-tenant
// later if needed — for now anything over these is almost certainly abuse
// or a loop.
export const DAILY_LIMITS: Record<UsageKind, number> = {
  generate:   200,
  add_sample: 50,
};

export interface LimitResult {
  allowed:   boolean;
  newCount:  number;
  limit:     number;
  /** Friendly message safe to surface in the UI when allowed is false. */
  message?:  string;
}

/**
 * Atomically increment the user's counter for `kind` and check whether they
 * have exceeded today's limit. The increment happens even on the over-limit
 * call — the cap is about throttling traffic, not gaming the counter.
 *
 * Fails open: if the RPC errors (e.g. usage_counters table not migrated yet),
 * we let the request through rather than block the user. Errors are logged
 * so the operator notices.
 */
export async function enforceDailyLimit(
  supabase: SupabaseClient,
  kind: UsageKind
): Promise<LimitResult> {
  const limit = DAILY_LIMITS[kind];

  const { data, error } = await supabase.rpc("increment_usage", {
    p_kind:  kind,
    p_limit: limit,
  });

  if (error) {
    console.error("[usage-limits] increment_usage failed — failing open:", error.message);
    return { allowed: true, newCount: 0, limit };
  }

  const row = Array.isArray(data) ? data[0] : data;
  const newCount = Number(row?.new_count ?? 0);
  const exceeded = Boolean(row?.exceeded);

  if (exceeded) {
    return {
      allowed:  false,
      newCount,
      limit,
      message:  `Daily limit reached (${limit} ${kind === "generate" ? "drafts" : "examples"} per day). Try again tomorrow.`,
    };
  }

  return { allowed: true, newCount, limit };
}
