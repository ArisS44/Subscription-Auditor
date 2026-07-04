-- profiles: one row per authenticated user, auto-created on signup.
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  display_name text,
  preferred_language text default 'auto' check (preferred_language in ('auto', 'en', 'el')),
  renewal_lead_days int default 3,
  monthly_review_enabled boolean default true,
  onboarding_completed boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table profiles enable row level security;

-- auth.uid() reads the caller's user id from their JWT; profiles.id is that
-- same uuid, so every policy scopes access to exactly the calling user's row.
create policy "Users can view their own profile"
  on profiles for select
  using (auth.uid() = id);

create policy "Users can insert their own profile"
  on profiles for insert
  with check (auth.uid() = id);

create policy "Users can update their own profile"
  on profiles for update
  using (auth.uid() = id);

create policy "Users can delete their own profile"
  on profiles for delete
  using (auth.uid() = id);

-- security definer: runs as the function owner (not the caller), since the
-- caller here is Supabase's internal Auth service inserting into auth.users,
-- which has no privilege to write into public.profiles on its own.
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
