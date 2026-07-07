-- subscriptions: many rows per authenticated user, one per tracked recurring
-- service. Unlike profiles (keyed on its own id = auth.uid()), this is a child
-- table with a separate user_id owning column, so every RLS policy keys on
-- auth.uid() = user_id.
create table subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  category text check (category in ('ai_tool', 'streaming', 'productivity', 'cloud_storage', 'other')),
  price numeric(10, 2) not null check (price >= 0),
  currency text not null default 'USD',
  billing_cycle text not null check (billing_cycle in ('weekly', 'monthly', 'quarterly', 'yearly')),
  start_date date not null,
  next_renewal_date date,
  status text not null default 'active' check (status in ('active', 'cancelled', 'paused')),
  cancellation_date date,
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table subscriptions enable row level security;

-- auth.uid() reads the caller's user id from their JWT; subscriptions.user_id is
-- that same uuid, so every policy scopes access to exactly the calling user's
-- rows. INSERT uses with-check (validates the row being written) since there is
-- no pre-existing row to filter — this is what stops a caller from writing a row
-- owned by someone else.
create policy "Users can view their own subscriptions"
  on subscriptions for select
  using (auth.uid() = user_id);

create policy "Users can insert their own subscriptions"
  on subscriptions for insert
  with check (auth.uid() = user_id);

create policy "Users can update their own subscriptions"
  on subscriptions for update
  using (auth.uid() = user_id);

create policy "Users can delete their own subscriptions"
  on subscriptions for delete
  using (auth.uid() = user_id);

-- (user_id, status) backs the list endpoint's default filter (a user's active
-- subscriptions); (user_id, next_renewal_date) backs the upcoming-renewals scan.
-- Both lead with user_id so RLS-scoped queries never do an unbounded table scan.
create index subscriptions_user_id_status_idx on subscriptions (user_id, status);
create index subscriptions_user_id_next_renewal_date_idx on subscriptions (user_id, next_renewal_date);
