/**
 * Style Learning Module
 *
 * Plugs into the existing generation pipeline.
 * All public functions are safe to call fire-and-forget — they catch their own
 * errors so that a style-memory failure never blocks email sending.
 *
 * Integration points:
 *   addStyleSample()       ← called by approveGeneration() after every send
 *   updateStyleProfile()   ← called by approveGeneration() after every send
 *   retrieveStyleContext() ← called by /api/ai/generate before building prompt
 */

import { GoogleGenerativeAI, TaskType } from "@google/generative-ai";
import type { SupabaseClient } from "@supabase/supabase-js";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

// Caps to keep embedding cost + latency low
const MAX_EMBED_CHARS    = 1_000;
const MIN_SAMPLE_WORDS   = 10;
const MAX_SAMPLE_WORDS   = 500;

// ─── Email text cleaning ──────────────────────────────────────────────────────
//
// Goal: extract only the user-authored text, removing:
//   - quoted reply chains (lines starting with ">")
//   - forwarded message blocks
//   - sign-off + everything below
//   - HTML tags (emails stored as raw HTML by the sync route)
//   - tracking URLs

export function cleanEmailText(raw: string): string {
  let text = raw ?? "";

  // Strip HTML
  if (text.trimStart().startsWith("<")) {
    text = text
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>/gi, "\n\n")
      .replace(/<\/div>/gi, "\n")
      .replace(/<[^>]+>/g, "")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .trim();
  }

  const lines = text.split("\n");
  const kept: string[] = [];
  let stop = false;

  for (const line of lines) {
    if (stop) continue;
    const t = line.trim();

    // Quoted reply line
    if (t.startsWith(">")) continue;

    // Forwarded block header
    if (/^-{3,}\s*(forwarded|original)\s+message\s*-{3,}/i.test(t)) {
      stop = true; continue;
    }

    // Gmail "On [date], [name] wrote:" quoted header
    if (/^on .{5,60}, .{3,50} wrote:$/i.test(t)) {
      stop = true; continue;
    }

    // Standard signature separators
    if (t === "--" || t === "—" || t === "___" || t === "---") {
      stop = true; continue;
    }

    // Sign-off line — stop collecting (the name below isn't useful signal)
    if (/^(best|thanks|thank you|thanks!|cheers|regards|sincerely|warm regards|kind regards|take care|speak soon|coach|yours|all the best),?\s*\.?$/i.test(t)) {
      stop = true; continue;
    }

    kept.push(line);
  }

  return kept
    .join("\n")
    // Remove bare tracking URLs
    .replace(/\(\s*https?:\/\/[^\s)]{20,}\s*\)/g, "")
    .split("\n")
    .filter((l) => {
      const t = l.trim();
      if (!t) return true;
      if (/^https?:\/\/\S+$/.test(t)) return false;
      return true;
    })
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ─── Style heuristics ─────────────────────────────────────────────────────────

export type ContextCluster = "work" | "personal" | "transactional" | "support" | "short_reply";

export function detectCluster(text: string, wc: number): ContextCluster {
  if (wc < 25) return "short_reply";
  const l = text.toLowerCase();
  if (/\b(invoice|receipt|order\s*#|payment|booking|reservation|confirmation)\b/.test(l)) return "transactional";
  if (/\b(issue|problem|error|broken|not working|can't|cannot|doesn't work)\b/.test(l)) return "support";
  return "work";
}

/** Returns 0 (formal) → 1 (casual). */
export function computeToneScore(text: string): number {
  const l = text.toLowerCase();
  const casual = [/\bhey\b/, /\byeah\b/, /\bcool\b/, /\bawesome\b/, /!/, /\bbtw\b/, /\bjust wanted\b/, /'\s*(m|re|ll|ve|t)\b/];
  const formal  = [/\bdear\b/, /\bsincerely\b/, /\bplease find\b/, /\bherewith\b/, /\bkindly\b/, /\bpursuant to\b/, /\bI hope this (email|message)\b/];
  let c = 0, f = 0;
  for (const p of casual) if (p.test(l)) c++;
  for (const p of formal)  if (p.test(l)) f++;
  const total = c + f;
  return total === 0 ? 0.5 : c / total;
}

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function extractGreeting(text: string): string | null {
  const first = text.split("\n").find((l) => l.trim().length > 0)?.trim() ?? "";
  return /^(hi|hey|hello|dear|good morning|good afternoon)\b/i.test(first)
    ? first.slice(0, 60)
    : null;
}

function extractSignoff(text: string): string | null {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const last = lines[lines.length - 1] ?? "";
  return /^(best|thanks|thank you|cheers|regards|coach|sincerely|warm regards|all the best)\b/i.test(last)
    ? last.slice(0, 60)
    : null;
}

// ─── Embedding ────────────────────────────────────────────────────────────────
//
// Model: gemini-embedding-001 (text-embedding-004 was retired and now returns 404).
// Native output is 3072 dims, but the schema stores vector(768) and the IVFFlat
// index can't be rebuilt to >2000 dims. gemini-embedding-001 is trained with
// Matryoshka Representation Learning, so truncating to the leading 768 dims
// preserves quality — provided the vector is renormalized to unit length, which
// is required for cosine-based pgvector ops to behave correctly.

const EMBED_DIM = 768;

function truncateAndRenormalize(values: number[], dim: number): number[] {
  const sliced = values.slice(0, dim);
  let sumSq = 0;
  for (const v of sliced) sumSq += v * v;
  const norm = Math.sqrt(sumSq);
  if (norm === 0) return sliced;
  return sliced.map((v) => v / norm);
}

export async function embedText(
  text: string,
  taskType: TaskType = TaskType.RETRIEVAL_DOCUMENT
): Promise<number[] | null> {
  try {
    const model = genAI.getGenerativeModel({ model: "gemini-embedding-001" });
    const result = await model.embedContent({
      content: { role: "user", parts: [{ text: text.slice(0, MAX_EMBED_CHARS) }] },
      taskType,
    });
    return truncateAndRenormalize(result.embedding.values, EMBED_DIM);
  } catch (err) {
    console.error("[style] embed error:", err);
    return null;
  }
}

// ─── Core public API ──────────────────────────────────────────────────────────

/**
 * Clean, embed, and store a single outbound email as a writing sample.
 *
 * Pass messageId when processing historical email_messages (backfill).
 * Pass generationId when processing a freshly-sent reply.
 * Both are nullable to simplify callers — at least one should be provided.
 */
export interface AddSampleResult {
  saved:   boolean;
  reason?: string;
}

export async function addStyleSample(
  supabase: SupabaseClient,
  userId: string,
  rawText: string,
  opts: { messageId?: string; generationId?: string } = {}
): Promise<AddSampleResult> {
  try {
    const cleanBody = cleanEmailText(rawText);
    const wc = wordCount(cleanBody);

    if (wc < MIN_SAMPLE_WORDS) {
      return { saved: false, reason: `Text too short after cleaning (${wc} words, minimum ${MIN_SAMPLE_WORDS})` };
    }
    if (wc > MAX_SAMPLE_WORDS) {
      return { saved: false, reason: `Text too long after cleaning (${wc} words, maximum ${MAX_SAMPLE_WORDS})` };
    }

    const embedding = await embedText(cleanBody, TaskType.RETRIEVAL_DOCUMENT);

    const row: Record<string, unknown> = {
      user_id:         userId,
      clean_body:      cleanBody,
      word_count:      wc,
      context_cluster: detectCluster(cleanBody, wc),
      embedding,
      weight:          1.0,
    };

    if (opts.messageId)    row.message_id    = opts.messageId;
    if (opts.generationId) row.generation_id = opts.generationId;

    const { error } = await supabase.from("style_samples").insert(row);

    if (error) {
      if (error.message.includes("duplicate")) {
        return { saved: true }; // already exists — idempotent success
      }
      console.error("[style] insert error:", error.message);
      return { saved: false, reason: error.message };
    }

    return { saved: true };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.error("[style] addStyleSample error:", reason);
    return { saved: false, reason };
  }
}

/**
 * Recompute and upsert the user's style_profile from their latest 100 samples.
 * Called after every new sample is added.
 */
export async function updateStyleProfile(
  supabase: SupabaseClient,
  userId: string
): Promise<void> {
  try {
    const { data: samples } = await supabase
      .from("style_samples")
      .select("clean_body, word_count")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(100);

    // No samples left (e.g. the user removed them all) — reset the profile to
    // zero so retrieveStyleContext stops injecting a stale voice into drafts.
    if (!samples?.length) {
      await supabase.from("style_profile").upsert(
        {
          user_id:          userId,
          sample_count:     0,
          avg_word_count:   0,
          tone_score:       0.5,
          uses_bullets:     false,
          common_greetings: [],
          common_signoffs:  [],
          updated_at:       new Date().toISOString(),
        },
        { onConflict: "user_id" }
      );
      return;
    }

    const tones       = samples.map((s) => computeToneScore(s.clean_body));
    const avgTone     = tones.reduce((a, b) => a + b, 0) / tones.length;
    const avgWords    = samples.reduce((a, s) => a + (s.word_count ?? 0), 0) / samples.length;
    const usesBullets = samples.some((s) => /^[-*•]\s/m.test(s.clean_body));

    const greetings = samples
      .map((s) => extractGreeting(s.clean_body))
      .filter(Boolean) as string[];
    const signoffs = samples
      .map((s) => extractSignoff(s.clean_body))
      .filter(Boolean) as string[];

    await supabase.from("style_profile").upsert(
      {
        user_id:          userId,
        sample_count:     samples.length,
        avg_word_count:   Math.round(avgWords * 10) / 10,
        tone_score:       Math.round(avgTone * 100) / 100,
        uses_bullets:     usesBullets,
        common_greetings: [...new Set(greetings)].slice(0, 5),
        common_signoffs:  [...new Set(signoffs)].slice(0, 5),
        updated_at:       new Date().toISOString(),
      },
      { onConflict: "user_id" }
    );
  } catch (err) {
    console.error("[style] updateStyleProfile error:", err);
  }
}

// ─── Retrieval ────────────────────────────────────────────────────────────────

export interface StyleContext {
  examples: string[];    // Top similar past replies, ordered by similarity
  profile: {
    sampleCount:     number;
    avgWordCount:    number;
    toneScore:       number;   // 0=formal, 1=casual
    usesBullets:     boolean;
    commonGreetings: string[];
    commonSignoffs:  string[];
  } | null;
}

/**
 * Retrieve the user's writing style context for injection into the LLM prompt.
 *
 * inboundText: the email(s) being replied to (used as query for similarity search).
 *
 * Returns null if the user has no samples yet (graceful degradation).
 * Never throws — callers can trust it to fail silently.
 */
export async function retrieveStyleContext(
  supabase: SupabaseClient,
  userId: string,
  inboundText: string
): Promise<StyleContext | null> {
  try {
    // Run embedding + profile fetch in parallel
    const [queryEmb, profileResult] = await Promise.all([
      embedText(inboundText.slice(0, MAX_EMBED_CHARS), TaskType.RETRIEVAL_QUERY),
      supabase
        .from("style_profile")
        .select("*")
        .eq("user_id", userId)
        .single(),
    ]);

    const profile = profileResult.data;

    // If no samples at all, return null (don't inject empty context)
    if (!profile || profile.sample_count === 0) return null;

    // Always inject the top-k most similar samples the user has.
    // match_style_samples already orders by cosine distance and limits to k,
    // so the worst it returns is still the closest the user has written.
    // The previous MIN_SIMILARITY=0.55 cutoff silently dropped every example
    // when the user's voice differed sharply from the inbound email's topic
    // (e.g. an old-English sample replied to a modern enquiry → empty examples
    // → prompt fell back to the model's default voice).
    const examples: string[] = [];

    if (queryEmb) {
      const { data: matches } = await supabase.rpc("match_style_samples", {
        query_emb:   queryEmb,
        match_count: 3,
      });

      if (matches?.length) {
        for (const m of matches) {
          examples.push(m.clean_body as string);
        }
      }
    }

    // Fallback: if embedding failed (queryEmb null) or RPC returned nothing,
    // fetch the most recent samples directly so the prompt still gets style.
    if (examples.length === 0) {
      const { data: recent } = await supabase
        .from("style_samples")
        .select("clean_body")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(3);
      if (recent?.length) {
        for (const r of recent) examples.push(r.clean_body as string);
      }
    }

    return {
      examples,
      profile: {
        sampleCount:     profile.sample_count,
        avgWordCount:    profile.avg_word_count,
        toneScore:       profile.tone_score,
        usesBullets:     profile.uses_bullets,
        commonGreetings: profile.common_greetings ?? [],
        commonSignoffs:  profile.common_signoffs  ?? [],
      },
    };
  } catch (err) {
    console.error("[style] retrieveStyleContext error:", err);
    return null;
  }
}

// ─── Prompt builder helper ────────────────────────────────────────────────────

/**
 * Returns the style section to prepend into the LLM prompt.
 * Returns empty string if no context is available (graceful degradation).
 */
export function buildStylePromptSection(ctx: StyleContext | null): string {
  if (!ctx) return "";

  const lines: string[] = [];

  if (ctx.profile) {
    const { toneScore, avgWordCount, usesBullets, commonGreetings, commonSignoffs } = ctx.profile;
    const toneLabel = toneScore > 0.6 ? "casual and warm" : toneScore < 0.4 ? "formal and professional" : "conversational";
    lines.push(`Writing style: ${toneLabel}, ~${Math.round(avgWordCount)} words per reply${usesBullets ? ", occasionally uses bullet points" : ""}.`);
    if (commonGreetings.length) lines.push(`Common greeting patterns: ${commonGreetings.slice(0, 2).join(" / ")}`);
    if (commonSignoffs.length)  lines.push(`Common sign-off patterns: ${commonSignoffs.slice(0, 2).join(" / ")}`);
  }

  if (ctx.examples.length) {
    lines.push("\nExamples of how this person writes replies — match this style closely:");
    ctx.examples.forEach((ex, i) => {
      lines.push(`\n[Example ${i + 1}]\n${ex.trim()}`);
    });
    lines.push(""); // trailing newline
  }

  return lines.length ? lines.join("\n") + "\n" : "";
}
