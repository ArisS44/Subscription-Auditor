-- Notification & guidance schema: push_subscriptions (user-scoped device
-- endpoints), notification_deliveries (the idempotency ledger for scheduled
-- sends), service_guides (global curated reference data), and a per-subscription
-- reminder lead-time override. Same RLS philosophy as the existing tables:
-- auth.uid() = user_id on every user-scoped row; reference data gets a single
-- authenticated-read policy and no write path.

-- ---------------------------------------------------------------------------
-- push_subscriptions: one row per user per device/browser.
-- ---------------------------------------------------------------------------
create table push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  -- The push service URL the browser handed us. Together with the two keys it
  -- is the full credential needed to deliver a message to that one device.
  endpoint text not null,
  p256dh_key text not null,
  auth_key text not null,
  -- Free-text, purely so a user can tell "Chrome on laptop" from "phone" when
  -- managing their devices. Never parsed, never used for logic.
  user_agent text,
  created_at timestamptz default now(),
  -- A laptop browser and a phone are separate endpoints with separate
  -- encryption keys, and permission is granted per-device — so one user
  -- legitimately has many rows. Uniqueness is on the device, not the user;
  -- re-subscribing the same device upserts on this key rather than duplicating.
  constraint push_subscriptions_user_endpoint_uniq unique (user_id, endpoint)
);

alter table push_subscriptions enable row level security;

create policy "Users can view their own push subscriptions"
  on push_subscriptions for select
  using (auth.uid() = user_id);

create policy "Users can insert their own push subscriptions"
  on push_subscriptions for insert
  with check (auth.uid() = user_id);

create policy "Users can update their own push subscriptions"
  on push_subscriptions for update
  using (auth.uid() = user_id);

-- Withdrawing consent for push must delete the stored credential outright, not
-- flag it — so the delete policy is load-bearing for the consent guarantee.
create policy "Users can delete their own push subscriptions"
  on push_subscriptions for delete
  using (auth.uid() = user_id);

-- No extra index: the unique constraint's implicit index leads with user_id, so
-- "list my devices" is already covered.

-- ---------------------------------------------------------------------------
-- notification_deliveries: the delivery ledger. This table is not primarily an
-- audit log — it is the mechanism that makes scheduled sending idempotent.
--
-- The job INSERTs here BEFORE attempting delivery. A unique violation means
-- some other invocation (a cron retry, a manual re-run, an overlapping replica)
-- already claimed this exact notification, so this one skips. An
-- application-level "have I already sent this?" SELECT would race — two callers
-- can both read "not sent" before either writes. A unique constraint cannot be
-- raced: one INSERT wins and the other is rejected by the storage engine.
-- ---------------------------------------------------------------------------
create table notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  -- Nullable: renewal reminders are about one subscription, but the
  -- monthly-review kind coming in a later session is about the account as a
  -- whole and has no subscription to point at.
  subscription_id uuid references subscriptions(id) on delete cascade,
  -- CHECK rather than a Postgres enum, matching the project convention
  -- (subscriptions.status, messages.role). Adding a future notification type is
  -- a one-line constraint change, not a schema redesign.
  kind text not null check (kind in ('renewal_reminder', 'monthly_review')),
  -- What the notification is *about* (the renewal date, or the period covered)
  -- — deliberately not the send date. Two different renewals of the same
  -- service are different keys and both get sent; the same renewal claimed
  -- twice is one key and the second attempt is rejected.
  due_date date not null,
  -- Claim time: written when the row is inserted, before delivery is attempted.
  created_at timestamptz not null default now(),
  -- Set only once the push provider accepted the message. NULL therefore means
  -- "claimed but never confirmed delivered", which is the state a crash between
  -- the INSERT and the send leaves behind.
  delivered_at timestamptz,
  -- `nulls not distinct` (Postgres 15+) is essential, not incidental: with the
  -- default NULLS DISTINCT, two monthly_review rows whose subscription_id is
  -- NULL would count as different keys and both would send, defeating the whole
  -- purpose for exactly the kind that needs it. Same reasoning as
  -- llm_usage_scope_day_uniq.
  constraint notification_deliveries_dedupe_uniq
    unique nulls not distinct (user_id, subscription_id, kind, due_date)
);

alter table notification_deliveries enable row level security;

create policy "Users can view their own notification deliveries"
  on notification_deliveries for select
  using (auth.uid() = user_id);

create policy "Users can insert their own notification deliveries"
  on notification_deliveries for insert
  with check (auth.uid() = user_id);

create policy "Users can update their own notification deliveries"
  on notification_deliveries for update
  using (auth.uid() = user_id);

create policy "Users can delete their own notification deliveries"
  on notification_deliveries for delete
  using (auth.uid() = user_id);

-- No index for the existence check: the unique constraint already provides one
-- on exactly that key.

-- ---------------------------------------------------------------------------
-- service_guides: curated per-service cancellation/plan guidance. Global
-- reference data with no per-user dimension, like fx_rates.
-- ---------------------------------------------------------------------------
create table service_guides (
  id uuid primary key default gen_random_uuid(),
  -- Stable lowercase slug ("netflix", "claude") used to match a user's
  -- subscription to its guide. Unique because it is the lookup key.
  service_key text unique not null,
  display_name text not null,
  -- Intentionally unconstrained (no CHECK against subscriptions.category): a
  -- curated catalogue should be extendable by data edits, not migrations.
  category text,
  -- Curated URLs only. These are project-controlled data, which is what makes
  -- them safe to render as real links — unlike a model-generated URL. The
  -- backend never fetches them either way.
  cancel_url text,
  signup_url text,
  -- Ordered list of steps and list of plan tiers. JSONB because the shape is
  -- content, not relational structure, and is validated by Pydantic at the API
  -- boundary before it is ever rendered.
  cancel_steps jsonb,
  plans jsonb,
  -- Domains the browser extension watches to attribute usage to this service.
  tracked_domains text[],
  is_trackable_by_extension boolean default false,
  updated_at timestamptz default now()
);

alter table service_guides enable row level security;

-- Reference data any signed-in user may read; there is no per-user dimension,
-- so a single authenticated-read policy replaces the four-policy pattern.
-- Critically, NO insert/update/delete policy exists for the `authenticated`
-- role — RLS denies by default, so the absence of a write policy IS the control
-- that makes this read-only to users. Curation happens through the backend
-- service role, which bypasses RLS and is never reachable from a user route.
create policy "Authenticated users can read service guides"
  on service_guides for select
  to authenticated
  using (true);

-- ---------------------------------------------------------------------------
-- subscriptions.reminder_lead_days: optional per-subscription override of how
-- many days before renewal to remind.
-- ---------------------------------------------------------------------------
-- Nullable is load-bearing: NULL means "inherit my profile default", resolved
-- as coalesce(subscriptions.reminder_lead_days, profiles.renewal_lead_days).
-- Because NULL already means inherit, existing rows are correct as they stand
-- and no backfill is required.
alter table subscriptions add column reminder_lead_days int
  check (reminder_lead_days >= 0 and reminder_lead_days <= 30);

-- The scheduled reminder job scans for renewals due inside a lead-time window
-- across ALL users, so it has no user_id to filter on — the existing
-- subscriptions indexes all lead with user_id and cannot serve it. This partial
-- index covers that scan and stays small by excluding cancelled/paused rows,
-- which the job never considers.
create index subscriptions_active_next_renewal_date_idx
  on subscriptions (next_renewal_date)
  where status = 'active';
