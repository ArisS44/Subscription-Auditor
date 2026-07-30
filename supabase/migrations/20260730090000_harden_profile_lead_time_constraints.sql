-- Give the profile lead-time columns a database-side wall.
--
-- Both columns were created nullable with a default, and the 0-30 bound on the
-- lead time lived only in Pydantic (`LeadDays` in backend/app/models/common.py).
-- That left the API as the single wall: anything reaching the table by another
-- route -- a psql session, a future job, a migration, a bug that bypasses the
-- request model -- could store a NULL or an out-of-range value unopposed.
--
-- Two concrete gaps this closes:
--
--   * `ProfileResponse` declares `renewal_lead_days: int` and
--     `monthly_review_enabled: bool` as non-nullable, so a NULL in either would
--     fail response validation and turn GET /me into a 500. "No NULL exists
--     today" was an observation; NOT NULL makes it a rule.
--
--   * `subscriptions.reminder_lead_days` already carries exactly this CHECK,
--     while the profile column it falls back to (the reminder engine resolves
--     COALESCE(s.reminder_lead_days, p.renewal_lead_days)) carried none. The two
--     bounds must agree or the fallback can be a value the override could never
--     hold, so they are now stated identically.
--
-- Verified safe before writing, on dev: 16 profile rows, zero NULLs in either
-- column, zero values outside 0-30 (observed range 3-11). NOT NULL is validated
-- against every existing row, so a single NULL would have aborted this.

alter table profiles
  alter column renewal_lead_days set not null,
  alter column monthly_review_enabled set not null;

-- Constraint name mirrors subscriptions_reminder_lead_days_check so the pair is
-- greppable as one rule expressed in two places.
alter table profiles
  add constraint profiles_renewal_lead_days_check
  check (renewal_lead_days >= 0 and renewal_lead_days <= 30);
