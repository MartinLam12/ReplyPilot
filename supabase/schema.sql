-- ============================================================
-- Run this in your Supabase SQL editor (Dashboard → SQL Editor)
-- ============================================================

-- Gym settings (one row per user)
create table if not exists gym_settings (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid references auth.users not null unique,
  gym_name              text not null default '',
  gym_context           text not null default '',
  gmail_email           text,
  gmail_refresh_token   text,
  gmail_last_synced_at  timestamptz,
  created_at            timestamptz default now(),
  updated_at            timestamptz default now()
);

alter table gym_settings enable row level security;
create policy "users own their gym_settings"
  on gym_settings for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Contacts (leads + members)
create table if not exists contacts (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid references auth.users not null,
  name                text,
  email               text not null,
  type                text check (type in ('lead','trial','member','inactive')) default 'lead',
  notes               text,
  last_contacted_at   timestamptz,
  created_at          timestamptz default now(),
  unique (user_id, email)
);

alter table contacts enable row level security;
create policy "users own their contacts"
  on contacts for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Email threads (grouped Gmail conversations)
create table if not exists email_threads (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid references auth.users not null,
  gmail_thread_id   text not null,
  contact_id        uuid references contacts,
  subject           text,
  status            text check (status in ('unread','pending_reply','replied','archived')) default 'unread',
  last_message_at   timestamptz,
  gmail_history_id  text,
  created_at        timestamptz default now(),
  unique (user_id, gmail_thread_id)
);

-- Per-thread Gmail historyId. Lets sync skip threads that have not changed
-- since the last run instead of re-fetching the whole mailbox every time.
alter table email_threads add column if not exists gmail_history_id text;

alter table email_threads enable row level security;
create policy "users own their email_threads"
  on email_threads for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create index if not exists email_threads_user_status on email_threads (user_id, status);
create index if not exists email_threads_last_message on email_threads (user_id, last_message_at desc);

-- Individual email messages
create table if not exists email_messages (
  id                uuid primary key default gen_random_uuid(),
  thread_id         uuid not null references email_threads on delete cascade,
  gmail_message_id  text not null unique,
  direction         text check (direction in ('inbound','outbound')) not null,
  from_email        text,
  to_email          text,
  subject           text,
  body_text         text,
  sent_at           timestamptz,
  created_at        timestamptz default now()
);

alter table email_messages enable row level security;
create policy "users own their email_messages via thread"
  on email_messages for all
  using (
    exists (
      select 1 from email_threads
      where email_threads.id = email_messages.thread_id
      and email_threads.user_id = auth.uid()
    )
  );

-- AI-generated drafts
create table if not exists ai_generations (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid references auth.users not null,
  thread_id           uuid references email_threads on delete cascade,
  type                text check (type in ('reply','follow_up')) not null,
  generated_subject   text,
  generated_body      text,
  confidence          numeric(3,2),
  risk_level          text check (risk_level in ('low','medium','high')) default 'low',
  status              text check (status in ('pending','approved','edited','rejected','sent')) default 'pending',
  final_body          text,
  created_at          timestamptz default now()
);

alter table ai_generations enable row level security;
create policy "users own their ai_generations"
  on ai_generations for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Email templates
create table if not exists templates (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references auth.users,
  name        text not null,
  type        text,
  subject     text not null,
  body        text not null,
  is_system   boolean default false,
  created_at  timestamptz default now()
);

alter table templates enable row level security;
create policy "users see their own and system templates"
  on templates for select
  using (auth.uid() = user_id or is_system = true);
create policy "users manage their own templates"
  on templates for all
  using (auth.uid() = user_id and is_system = false)
  with check (auth.uid() = user_id and is_system = false);

-- Scheduled follow-ups (Phase 2)
create table if not exists scheduled_follow_ups (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid references auth.users not null,
  contact_id          uuid references contacts not null,
  thread_id           uuid references email_threads,
  template_id         uuid references templates,
  type                text check (type in ('trial_reminder','missed_class','inactive_member','lead_followup','renewal')),
  scheduled_at        timestamptz not null,
  status              text check (status in ('pending','sent','cancelled','failed')) default 'pending',
  qstash_message_id   text,
  ai_generation_id    uuid references ai_generations,
  created_at          timestamptz default now()
);

alter table scheduled_follow_ups enable row level security;
create policy "users own their scheduled_follow_ups"
  on scheduled_follow_ups for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Activity log
create table if not exists activity_logs (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references auth.users not null,
  entity_type text,
  entity_id   uuid,
  action      text,
  metadata    jsonb,
  created_at  timestamptz default now()
);

alter table activity_logs enable row level security;
create policy "users own their activity_logs"
  on activity_logs for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ============================================================
-- Profiles (subscription tracking, one row per user)
-- ============================================================

create table if not exists profiles (
  id                    uuid primary key references auth.users on delete cascade,
  stripe_customer_id    text,
  subscription_status   text not null default 'inactive',
  subscription_id       text,
  current_period_end    timestamptz,
  created_at            timestamptz default now(),
  updated_at            timestamptz default now()
);

alter table profiles enable row level security;
create policy "users read own profile"
  on profiles for select
  using (auth.uid() = id);
-- Inserts and updates are done via service role in the webhook handler only.

create unique index if not exists profiles_stripe_customer_id_key
  on profiles (stripe_customer_id)
  where stripe_customer_id is not null;

-- Auto-create a profile row when a new user signs up.
create or replace function handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.profiles (id)
  values (new.id)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure handle_new_user();

-- ============================================================
-- Seed system templates
-- ============================================================
insert into templates (name, type, subject, body, is_system) values
  (
    'New Lead Response',
    'lead_followup',
    'Re: Your enquiry about {{gym_name}}',
    'Hi {{name}},

Thanks for reaching out to {{gym_name}}! We''d love to have you come in and try a class.

We offer a free trial session so you can get a feel for the gym and meet the coaches. Just let us know what days/times work best for you and we''ll get you booked in.

Looking forward to hearing from you!

Coach',
    true
  ),
  (
    'Trial Reminder',
    'trial_reminder',
    'Your trial class is tomorrow!',
    'Hi {{name}},

Just a quick reminder that your trial class at {{gym_name}} is tomorrow. We''re looking forward to seeing you!

If anything comes up and you need to reschedule, just reply to this email — no problem at all.

See you on the mat!

Coach',
    true
  ),
  (
    'Thanks For Coming',
    'missed_class',
    'Great work today, {{name}}!',
    'Hi {{name}},

It was great to have you in class today! You worked really hard and should be proud.

Keep showing up consistently — that''s where the real progress happens. We''ll see you next session!

Coach',
    true
  ),
  (
    'We Miss You',
    'inactive_member',
    'We''ve missed you at {{gym_name}}!',
    'Hi {{name}},

We''ve noticed you haven''t been in for a little while and just wanted to check in. Life gets busy — we get it!

Whenever you''re ready to get back on the mat, we''ll be here. If there''s anything we can do to make it easier for you to come back, just let us know.

Hope to see you soon!

Coach',
    true
  ),
  (
    'Membership Renewal',
    'renewal',
    'Your membership at {{gym_name}} — quick note',
    'Hi {{name}},

Your membership at {{gym_name}} is coming up for renewal soon. We''d love to have you continue training with us!

If you have any questions or want to discuss membership options, just reply to this email and we''ll sort it out.

Thanks for being part of our community!

Coach',
    true
  )
on conflict do nothing;
