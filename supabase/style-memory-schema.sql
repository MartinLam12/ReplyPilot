-- ============================================================
-- Style Learning Module — run after schema.sql
-- ============================================================

-- Enable pgvector (safe to run if already enabled)
create extension if not exists vector;

-- ─── Style voice samples ─────────────────────────────────────────────────────
-- One row per cleaned outbound email used as a writing sample.
-- Linked to email_messages (backfill) or ai_generations (live sends).

create table if not exists style_samples (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid references auth.users not null,
  message_id      uuid references email_messages(id) on delete set null,
  generation_id   uuid references ai_generations(id) on delete set null,
  clean_body      text not null,
  word_count      int not null,
  context_cluster text check (context_cluster in ('work','personal','transactional','support','short_reply')),
  embedding       vector(768),
  weight          numeric(3,2) not null default 1.0,
  created_at      timestamptz default now(),

  -- Prevent re-processing the same source
  unique (message_id),
  unique (generation_id)
);

alter table style_samples enable row level security;

create policy "users own their style_samples"
  on style_samples for all
  using  (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Fast user lookup
create index if not exists style_samples_user_id
  on style_samples (user_id);

-- IVFFlat index for approximate nearest-neighbour search.
-- lists=50 is appropriate for tables up to ~500k rows per user cluster.
-- Rebuild with lists=200 when total rows exceed 1M.
create index if not exists style_samples_embedding_ivfflat
  on style_samples
  using ivfflat (embedding vector_cosine_ops)
  with (lists = 50);

-- ─── Style profile ───────────────────────────────────────────────────────────
-- One row per user. Summarises writing patterns across all samples.

create table if not exists style_profile (
  user_id           uuid references auth.users primary key,
  sample_count      int             not null default 0,
  avg_word_count    numeric(6,1)    not null default 0,
  tone_score        numeric(3,2)    not null default 0.5, -- 0=formal, 1=casual
  uses_bullets      boolean         not null default false,
  common_greetings  text[]          not null default '{}',
  common_signoffs   text[]          not null default '{}',
  updated_at        timestamptz     default now()
);

alter table style_profile enable row level security;

create policy "users own their style_profile"
  on style_profile for all
  using  (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ─── Style feedback ──────────────────────────────────────────────────────────
-- Records user rating on AI-generated replies.
-- Used to reweight retrieval (boost good examples, demote bad ones).

create table if not exists style_feedback (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid references auth.users not null,
  generation_id  uuid references ai_generations(id) on delete cascade not null,
  rating         text check (rating in ('good','too_formal','too_casual','wrong_style')) not null,
  created_at     timestamptz default now(),
  unique (generation_id) -- one rating per generation
);

alter table style_feedback enable row level security;

create policy "users own their style_feedback"
  on style_feedback for all
  using  (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ─── RPC: vector similarity search ───────────────────────────────────────────
-- ⚠️ APPLY MANUALLY: paste this whole block into the Supabase SQL editor and run it.
--    Schema in this repo is NOT auto-migrated — editing this file alone changes nothing.
-- Called from /api/ai/generate to retrieve the user's most similar past replies.
--
-- security invoker means it runs with the calling user's permissions,
-- so RLS on style_samples automatically restricts results to auth.uid().
--
-- Ranking now factors in the feedback `weight` (good → ↑weight, wrong_style → ↓weight):
--     effective_rank = cosine_distance * (1.0 / weight)
-- A higher-weight sample is treated as "closer" and surfaces first; a demoted
-- (low-weight) sample sinks. This is what makes the "Sound like you? Yes/No"
-- feedback actually affect future drafts.
--
-- Trade-off: blending weight into ORDER BY means the IVFFlat index can no longer
-- serve the sort directly (it indexes raw distance), so this performs a per-user
-- scan + sort. Fine at current per-user sample volumes (RLS scopes to one user);
-- revisit only if a single user ever stores tens of thousands of samples.

-- Return type changes (adds `weight`), so the existing function must be dropped
-- first — CREATE OR REPLACE cannot alter a function's return table.
drop function if exists match_style_samples(vector, int);

create function match_style_samples(
  query_emb   vector(768),
  match_count int default 3
)
returns table (
  id              uuid,
  clean_body      text,
  word_count      int,
  context_cluster text,
  similarity      float,
  weight          numeric
)
language sql stable
security invoker
as $$
  select
    ss.id,
    ss.clean_body,
    ss.word_count,
    ss.context_cluster,
    1 - (ss.embedding <=> query_emb) as similarity,
    ss.weight
  from  style_samples ss
  where ss.embedding  is not null
    and ss.word_count >= 10
  order by (ss.embedding <=> query_emb) * (1.0 / nullif(ss.weight, 0))
  limit match_count;
$$;

-- Grant execute to authenticated users
grant execute on function match_style_samples(vector, int) to authenticated;

-- ─── RPC: apply feedback weight adjustment ────────────────────────────────────
-- After recording feedback, call this to bump/debump the sample's weight.

create or replace function apply_style_feedback(
  p_generation_id  uuid,
  p_rating         text
)
returns void
language plpgsql
security invoker
as $$
declare
  v_delta numeric := case
    when p_rating = 'good'        then  0.2
    when p_rating = 'too_formal'  then -0.1
    when p_rating = 'too_casual'  then -0.1
    when p_rating = 'wrong_style' then -0.2
    else 0
  end;
begin
  update style_samples
  set    weight = greatest(0.1, least(2.0, weight + v_delta))
  where  generation_id = p_generation_id
    and  user_id = auth.uid();
end;
$$;

grant execute on function apply_style_feedback(uuid, text) to authenticated;
