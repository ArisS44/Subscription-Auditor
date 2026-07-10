-- Chat schema for the Apollon chatbot feature: conversations + messages (both
-- user-scoped), fx_rates (global reference data), llm_usage (DB-backed daily
-- spend counters), and a user-provided manage_url on subscriptions. Same RLS
-- philosophy as the existing tables: auth.uid() = user_id on every user-scoped
-- row, with the DB as the second wall behind Pydantic validation.

-- ---------------------------------------------------------------------------
-- conversations: one row per chat thread, many per user.
-- ---------------------------------------------------------------------------
create table conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  -- Nullable: the chat engine auto-generates a title from the first user
  -- message in a later task; a fresh thread has none yet.
  title text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table conversations enable row level security;

-- Same four-policy pattern as subscriptions: auth.uid() (the caller's id from
-- their JWT) must equal user_id. INSERT uses with-check to stop a caller from
-- writing a row owned by someone else; the rest use using().
create policy "Users can view their own conversations"
  on conversations for select
  using (auth.uid() = user_id);

create policy "Users can insert their own conversations"
  on conversations for insert
  with check (auth.uid() = user_id);

create policy "Users can update their own conversations"
  on conversations for update
  using (auth.uid() = user_id);

create policy "Users can delete their own conversations"
  on conversations for delete
  using (auth.uid() = user_id);

-- Leads with user_id so an RLS-scoped "list my conversations, newest first"
-- never does an unbounded scan; updated_at desc backs the default ordering.
create index conversations_user_id_updated_at_idx
  on conversations (user_id, updated_at desc);

-- ---------------------------------------------------------------------------
-- messages: the turns within a conversation.
-- ---------------------------------------------------------------------------
create table messages (
  id uuid primary key default gen_random_uuid(),
  -- on delete cascade: deleting a conversation deletes its messages. This is a
  -- GDPR-alignment requirement (a user removing a thread removes its content),
  -- not incidental cleanup.
  conversation_id uuid not null references conversations(id) on delete cascade,
  -- Denormalized owner so RLS can scope messages directly on auth.uid() without
  -- a join back to conversations; also cascades if the user is deleted.
  user_id uuid not null references auth.users(id) on delete cascade,
  -- CHECK rather than a Postgres enum, matching the project convention
  -- (subscriptions.status, profiles.preferred_language). Kept byte-identical to
  -- the Literal in backend/app/models/chat.py.
  role text not null check (role in ('user', 'assistant', 'tool', 'system')),
  -- Nullable: a tool-call-only assistant turn carries no text, just tool_calls.
  content text,
  -- The assistant's requested tool calls (provider-normalized shape).
  tool_calls jsonb,
  -- Links a role='tool' result message back to the assistant tool call it answers.
  tool_call_id text,
  -- Validated chart/table payloads produced by a later task; rendered through
  -- typed components, never as raw HTML.
  structured_payload jsonb,
  created_at timestamptz default now()
);

alter table messages enable row level security;

create policy "Users can view their own messages"
  on messages for select
  using (auth.uid() = user_id);

create policy "Users can insert their own messages"
  on messages for insert
  with check (auth.uid() = user_id);

create policy "Users can update their own messages"
  on messages for update
  using (auth.uid() = user_id);

create policy "Users can delete their own messages"
  on messages for delete
  using (auth.uid() = user_id);

-- The access path for replaying/paginating a thread's history in order.
create index messages_conversation_id_created_at_idx
  on messages (conversation_id, created_at);

-- ---------------------------------------------------------------------------
-- fx_rates: global currency-conversion reference data, NOT user-scoped.
-- ---------------------------------------------------------------------------
create table fx_rates (
  id uuid primary key default gen_random_uuid(),
  -- ISO 4217 codes, uppercase (e.g. USD, EUR). CHECK mirrors the Pydantic caps.
  base text not null check (base ~ '^[A-Z]{3}$'),
  quote text not null check (quote ~ '^[A-Z]{3}$'),
  -- Wide numeric so small/large cross-rates keep precision.
  rate numeric(18, 8) not null check (rate > 0),
  fetched_at timestamptz not null default now(),
  -- One current row per directed pair; the backend upserts the latest rate on
  -- this key via the service role.
  constraint fx_rates_base_quote_uniq unique (base, quote)
);

alter table fx_rates enable row level security;

-- Reference data any signed-in user may read; there is no per-user dimension, so
-- a single authenticated-read policy replaces the four-policy pattern. No
-- insert/update/delete policy exists for the `authenticated` role — writes come
-- only from the backend service role, which bypasses RLS.
create policy "Authenticated users can read fx rates"
  on fx_rates for select
  to authenticated
  using (true);

-- ---------------------------------------------------------------------------
-- llm_usage: DB-backed daily request/token counters, per-user and app-wide.
-- Must be DB-backed (not in-memory) so it is correct across horizontally
-- scaled replicas and survives restarts.
-- ---------------------------------------------------------------------------
create table llm_usage (
  id uuid primary key default gen_random_uuid(),
  -- NULL user_id is the app-wide counter for the day; a non-NULL user_id is that
  -- user's counter. `unique nulls not distinct` (Postgres 15+) treats the NULL
  -- app-wide rows as equal, so there is exactly one counter row per (scope, day)
  -- and the counter service can upsert with a single ON CONFLICT target.
  user_id uuid references auth.users(id) on delete cascade,
  day date not null,
  request_count int not null default 0,
  input_tokens bigint not null default 0,
  output_tokens bigint not null default 0,
  updated_at timestamptz not null default now(),
  constraint llm_usage_scope_day_uniq unique nulls not distinct (user_id, day)
);

alter table llm_usage enable row level security;

-- A user may read only their own counter row. auth.uid() = user_id is never true
-- for the app-wide (NULL) row, so app-wide totals stay invisible to end users.
-- No insert/update/delete policy: all writes go through the backend service role
-- (bypassing RLS), which is what keeps the counters authoritative.
create policy "Users can view their own usage"
  on llm_usage for select
  using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- subscriptions.manage_url: optional user-provided link to the provider's
-- manage/cancel page. Display-only — never fetched by the backend, so no SSRF
-- surface. Format/length are validated at the API boundary (Pydantic), matching
-- how the other free-text caps live in the models rather than the DB.
-- ---------------------------------------------------------------------------
alter table subscriptions add column manage_url text;
