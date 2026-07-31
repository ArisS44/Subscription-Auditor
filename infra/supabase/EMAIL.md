# Supabase Auth — Custom SMTP (transactional email)

How signup confirmation, password reset, and email-change messages are delivered, and what to do when
they stop arriving.

**No credential appears in this file.** The SMTP key lives only in Supabase Auth's configuration, which
is not version-controlled. This records *what* was configured and *where*, so the setup is recoverable
without ever committing the secret.

---

## Why this exists

Supabase Auth sends an email on every signup. Out of the box it uses Supabase's **shared** sender — one
mail server used by every project on the platform. Because one abusive project could destroy
deliverability for all of them, it is throttled to a handful of messages per hour and Supabase documents
it as unsuitable for production.

That limit is not theoretical: during Session 3 verification a real user attempting to sign up on
production hit `over_email_send_rate_limit`, and every subsequent signup was blocked. A small group
signing up together exhausts the shared sender's hourly allowance and locks out everyone after the first
few — the app appears broken with no server-side error.

Custom SMTP hands each message to a provider account we control instead. The limit becomes the
provider's, and deliverability rests on our own sending reputation rather than a shared one.

---

## What is configured (production only)

**Provider: Brevo**, free plan.

| Setting | Value |
|---|---|
| SMTP host | `smtp-relay.brevo.com` |
| Port | `587` (STARTTLS) |
| SMTP login | `b3fbab001@smtp-brevo.com` |
| SMTP key | in Supabase Auth config only — **never in this repo** |
| Verified sender | `arisskyllas2004@gmail.com` |
| From name | `Subscription Auditor` |
| Supabase project | production, `ylwjevannrlsauegwbas` |

Configured at **Authentication → Emails → SMTP Settings** in the Supabase dashboard (also settable via
the Management API at `/v1/projects/{ref}/config/auth`, consistent with how the password policy was
applied).

The Supabase-side hourly cap at **Authentication → Rate Limits → "Rate limit for sending emails"** was
raised to **100/hour**. Supabase enforces its own cap even when custom SMTP is supplied, so leaving it
low would simply substitute a Supabase limit for the Brevo one.

**Free-tier ceiling: 300 emails/day** (~9,000/month). Every confirmation, password reset, and
email-change message counts against it. For a beta of a handful of users this is very large headroom.

### The SMTP login is not the sender address

`b3fbab001@smtp-brevo.com` is an authentication identifier only and must never appear in a From field.
The sender is the separately verified address above. Swapping the two is the most common way this
configuration fails.

### No custom domain — and why mail still reaches the inbox

The project owns no domain, so the sender was verified as an individual address (Brevo mails a 6-digit
code to it) rather than by domain authentication. Brevo warns that free-provider addresses land in spam.

In practice they do not, because **Brevo rewrites the envelope sender to its own authenticated
subdomain** — observed as `arisskyllas2004@11795371.brevosend.com` — which carries valid SPF and DKIM.
The recipient sees the display name `Subscription Auditor`. A test message landed in the Gmail inbox,
not spam.

When a custom domain is acquired, authenticate it in Brevo (DKIM + SPF records) and create a sender on
it. The SMTP credentials do not change, so the switch is a sender-address change in Supabase and nothing
else.

---

## Known limitations

**Auth emails are English-only.** Supabase Auth templates are a single fixed template per project with no
per-user language selection, so a Greek user signs up through a Greek interface and receives an English
confirmation. This is the one user-facing surface that is not bilingual — push notifications *are*
(`profiles.preferred_language`, see the notification copy module). Resolving it means either a template
containing both languages or sending confirmations from the backend instead. Not yet decided.

**The SMTP key expires in two independent ways.** It carries a fixed expiry (set to **31 July 2027**)
**and** expires after **90 days of inactivity** regardless of that date. A personal project can easily go
90 days without a signup or password reset, after which the key dies on its own and signups begin failing
silently — the same symptom as the original shared-sender limit, months later, with no obvious cause.
**If signup emails stop arriving and nothing changed, check the key's status in Brevo first.** Sending a
test message every couple of months resets the inactivity clock.

**Dev is deliberately not configured.** The dev project (`zocfhyysnvptxktqezfk`) still uses Supabase's
shared sender. Dev sends few emails, and pointing it at the same Brevo account would spend the
production allowance on test traffic. The tradeoff is accepted knowingly: this is a dev/prod difference
on the signup path, and that exact class of gap produced two production-only defects in Session 3 (the
CAPTCHA path and push revocation). Signup email behaviour therefore cannot be trusted from dev alone and
must be verified against production.
