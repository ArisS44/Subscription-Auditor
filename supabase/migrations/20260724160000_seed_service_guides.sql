-- Seed service_guides with curated cancellation guidance for well-known
-- services. Data-only migration (no schema change); the table and its RLS were
-- created in 20260722143000_create_notification_schema.sql.
--
-- Curated data is the "verified" tier of the guidance feature: a cancel_url here
-- is a project-controlled destination the frontend may render as a real link,
-- unlike a model-generated URL. So correctness is the bar — cancel_url is set
-- only where the destination is stable and verified; where a service cancels
-- in-app or on-device with no stable web deep-link, cancel_url is left NULL and
-- the steps carry the instructions instead. A wrong URL would be worse than none.
--
-- `plans` is deliberately left NULL: plan prices change often and are
-- financially material, so shipping a stale price would be the same fabrication
-- risk the assistant is being tightened against. Prices come from the user's own
-- entered data, never from this table.
--
-- Idempotent: ON CONFLICT (service_key) DO UPDATE so re-applying refreshes the
-- curated content rather than erroring on the unique slug.

insert into service_guides
  (service_key, display_name, category, cancel_url, signup_url, cancel_steps,
   tracked_domains, is_trackable_by_extension)
values
  -- ---- streaming ----------------------------------------------------------
  ('netflix', 'Netflix', 'streaming',
   'https://www.netflix.com/cancelplan', 'https://www.netflix.com/signup',
   '["Sign in to netflix.com", "Open Account from the profile menu", "Under Membership, select Cancel Membership", "Confirm cancellation"]',
   '{netflix.com}', true),

  ('spotify', 'Spotify', 'streaming',
   'https://www.spotify.com/account/', 'https://www.spotify.com/signup',
   '["Log in at spotify.com/account", "Open Your Plan (or Available Plans)", "Select Cancel Premium", "Confirm — Premium runs until the end of the paid period"]',
   '{spotify.com,open.spotify.com}', true),

  ('disney_plus', 'Disney+', 'streaming',
   'https://www.disneyplus.com/account/subscription', 'https://www.disneyplus.com/sign-up',
   '["Sign in at disneyplus.com", "Open Account, then Subscription", "Select Cancel Subscription", "Confirm"]',
   '{disneyplus.com}', true),

  ('max', 'Max (HBO)', 'streaming',
   'https://www.max.com/account', 'https://www.max.com/sign-up',
   '["Sign in at max.com", "Open your Account / profile settings", "Select Manage Subscription, then Cancel", "Note: if you subscribed via Apple, Amazon, or a TV provider, cancel with that provider instead"]',
   '{max.com,hbomax.com}', true),

  ('youtube_premium', 'YouTube Premium', 'streaming',
   'https://www.youtube.com/paid_memberships', 'https://www.youtube.com/premium',
   '["Go to youtube.com/paid_memberships while signed in", "Find YouTube Premium and select Manage", "Select Deactivate / Cancel membership", "Confirm"]',
   '{youtube.com}', true),

  ('apple_tv_plus', 'Apple TV+', 'streaming',
   'https://apps.apple.com/account/subscriptions', null,
   '["On iPhone/iPad: Settings, tap your name, then Subscriptions", "On Mac: App Store, then your name, then View Information", "Or open apps.apple.com/account/subscriptions in a browser", "Select Apple TV+ and choose Cancel Subscription"]',
   '{tv.apple.com}', true),

  -- ---- ai_tool -------------------------------------------------------------
  ('chatgpt_plus', 'ChatGPT Plus', 'ai_tool',
   null, 'https://chatgpt.com',
   '["Open ChatGPT and click your name, then Settings", "Open Subscription (or Manage my subscription)", "Select Cancel Plan in the billing portal", "Confirm — access continues until the period ends"]',
   '{chatgpt.com,openai.com}', true),

  ('claude_pro', 'Claude Pro', 'ai_tool',
   null, 'https://claude.ai',
   '["Open claude.ai and go to Settings", "Open Billing", "Select Manage subscription, then Cancel plan", "Confirm"]',
   '{claude.ai}', true),

  ('github_copilot', 'GitHub Copilot', 'ai_tool',
   'https://github.com/settings/copilot', 'https://github.com/features/copilot',
   '["Go to github.com/settings/copilot", "Under Copilot, open the subscription settings", "Select Cancel Copilot", "Confirm"]',
   '{github.com}', true),

  ('cursor', 'Cursor', 'ai_tool',
   'https://www.cursor.com/settings', 'https://www.cursor.com',
   '["Sign in at cursor.com and open Settings / Dashboard", "Open the Billing section", "Select Manage subscription, then Cancel", "Confirm"]',
   '{cursor.com,cursor.sh}', true),

  ('perplexity', 'Perplexity Pro', 'ai_tool',
   'https://www.perplexity.ai/settings/account', 'https://www.perplexity.ai',
   '["Sign in at perplexity.ai", "Open Settings, then Account", "Select Manage / Cancel subscription", "Confirm"]',
   '{perplexity.ai}', true),

  -- ---- productivity --------------------------------------------------------
  ('notion', 'Notion', 'productivity',
   null, 'https://www.notion.so',
   '["Open Notion and go to Settings & members", "Open the Billing (Plans) tab for your workspace", "Select Change plan / Cancel subscription", "Confirm — downgrades to Free at period end"]',
   '{notion.so}', true),

  ('figma', 'Figma', 'productivity',
   null, 'https://www.figma.com',
   '["Open figma.com and go to your account/workspace Settings", "Open the Billing tab", "Lower the paid seats to zero or cancel the plan", "Confirm"]',
   '{figma.com}', true),

  ('grammarly', 'Grammarly', 'productivity',
   'https://account.grammarly.com/subscription', 'https://www.grammarly.com',
   '["Sign in at account.grammarly.com", "Open the Subscription page", "Select Cancel Subscription", "Confirm"]',
   '{grammarly.com}', true),

  ('1password', '1Password', 'productivity',
   null, 'https://1password.com',
   '["Sign in to your account at <account>.1password.com", "Open the Billing section", "Select Manage plan, then cancel / delete the subscription", "Confirm"]',
   '{1password.com}', true),

  -- ---- cloud_storage -------------------------------------------------------
  ('icloud_plus', 'iCloud+', 'cloud_storage',
   'https://apps.apple.com/account/subscriptions', null,
   '["On iPhone/iPad: Settings, tap your name, then iCloud, then Manage Account Storage / Change Storage Plan", "Select Downgrade Options and choose the free plan", "Or manage at apps.apple.com/account/subscriptions", "Confirm"]',
   '{icloud.com}', false),

  ('google_one', 'Google One', 'cloud_storage',
   'https://one.google.com', 'https://one.google.com',
   '["Go to one.google.com while signed in", "Open Settings", "Select Cancel membership (or Change / downgrade plan)", "Confirm"]',
   '{one.google.com,google.com}', true),

  ('dropbox', 'Dropbox', 'cloud_storage',
   'https://www.dropbox.com/account/plan', 'https://www.dropbox.com',
   '["Sign in at dropbox.com", "Open Settings, then the Plan tab", "Select Cancel plan", "Confirm — reverts to Basic at period end"]',
   '{dropbox.com}', true)

on conflict (service_key) do update set
  display_name = excluded.display_name,
  category = excluded.category,
  cancel_url = excluded.cancel_url,
  signup_url = excluded.signup_url,
  cancel_steps = excluded.cancel_steps,
  tracked_domains = excluded.tracked_domains,
  is_trackable_by_extension = excluded.is_trackable_by_extension,
  updated_at = now();
