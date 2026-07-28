# Azure Setup — Provisioning & Key Vault

Ordered, reproducible `az` CLI steps to stand up the production Azure environment for this app. Run
these yourself against your own subscription (see `CLAUDE.md`'s External-platform / User-driven
Steps rule — Claude prepares commands and explains them, but never runs live cloud provisioning or
secret-setting commands on your behalf).

**Naming convention used below:** prefix `subscription-auditor`, region `germanywestcentral`. Change
both `RG`/`LOCATION` variables at the top of each block if you want different values — nothing below
is hardcoded beyond that.

**Region note:** this subscription (Azure for Students) is restricted by an `Allowed resource
deployment regions` policy to five regions: `uaenorth`, `swedencentral`, `germanywestcentral`,
`austriaeast`, `italynorth`. `italynorth` is geographically closer to Greece but doesn't yet support
every resource type this project needs in practice, so `germanywestcentral` is used throughout for
consistency. To check the current allowed list on a different subscription:

```bash
ASSIGNMENT_ID=$(az policy assignment list --query "[?name=='sys.regionrestriction'].id" -o tsv)
az rest --method get --url "https://management.azure.com${ASSIGNMENT_ID}?api-version=2022-06-01" \
  --query "properties.parameters.listOfAllowedLocations.value"
```

**Resource provider registration:** a fresh subscription typically has most resource providers
(the Azure services behind each resource type) unregistered. Before creating anything below, register
the ones this task needs — this is a one-time, subscription-wide step:

```bash
for ns in Microsoft.ContainerRegistry Microsoft.App Microsoft.OperationalInsights \
          Microsoft.KeyVault Microsoft.Web Microsoft.Insights Microsoft.ManagedIdentity; do
  az provider register --namespace "$ns"
done

# Poll until all show "Registered" (registration is asynchronous, can take a few minutes):
for ns in Microsoft.ContainerRegistry Microsoft.App Microsoft.OperationalInsights \
          Microsoft.KeyVault Microsoft.Web Microsoft.Insights Microsoft.ManagedIdentity; do
  az provider show --namespace "$ns" --query "[namespace,registrationState]" -o tsv
done
```

**Never commit real secret values.** Every command below either uses a placeholder (`<...>`) you fill
in at your own terminal, or reads from a local shell variable you've exported yourself — the values
never need to appear in this file, in a commit, or pasted into chat.

---

## 0. Prerequisites

- Azure CLI installed (`az version`) and logged in (`az login`).
- An active subscription with your project's Azure for Students (or other) subscription set as
  default: `az account show` to confirm, `az account set --subscription "<name-or-id>"` if not.

```bash
az login
az account set --subscription "Azure for Students"   # or your subscription name/ID
```

---

## 1. Resource group

A resource group is a logical container — everything below lives inside it, and deleting the group
deletes everything in it in one step (useful for tearing down a test environment cleanly).

```bash
RG=rg-subscription-auditor-prod
LOCATION=germanywestcentral

az group create --name "$RG" --location "$LOCATION"
```

---

## 2. Azure Container Registry (ACR, Basic tier)

A private Docker registry. CI (Task 4.2) builds the backend image and pushes it here; the Container
App (below) pulls from here to run it. Basic tier is the cheapest tier and sufficient for a single
backend image with a handful of tags.

ACR names must be **globally unique across all of Azure**, alphanumeric only (no hyphens), 5–50
characters.

```bash
ACR_NAME=acrsubscriptionauditor   # must be globally unique; check first:
az acr check-name --name "$ACR_NAME"

az acr create \
  --resource-group "$RG" \
  --name "$ACR_NAME" \
  --sku Basic
```

If the name is taken, pick another (e.g. append initials/digits) and re-run `az acr check-name`.

**Record the login server** (`<ACR_NAME>.azurecr.io`) — Task 4.2's CI workflow needs it:

```bash
az acr show --name "$ACR_NAME" --query loginServer -o tsv
```

---

## 3. Container Apps environment + backend Container App (consumption, scale-to-zero)

The **environment** is a shared boundary (networking, logging) that one or more Container Apps run
inside. The **Container App** itself is the actual running backend.

The real backend image isn't in ACR until Task 4.2's CI pushes it, so this Container App starts from
Azure's public quickstart placeholder image. Task 4.2 updates the revision to the real image — this
step's job is just to stand up the app, its ingress, and its identity.

```bash
ENV_NAME=cae-subscription-auditor-prod
APP_NAME=ca-subscription-auditor-backend

az containerapp env create \
  --resource-group "$RG" \
  --name "$ENV_NAME" \
  --location "$LOCATION"

az containerapp create \
  --resource-group "$RG" \
  --name "$APP_NAME" \
  --environment "$ENV_NAME" \
  --image mcr.microsoft.com/k8se/quickstart:latest \
  --target-port 8000 \
  --ingress external \
  --min-replicas 0 \
  --max-replicas 2 \
  --system-assigned
```

- `--target-port 8000` — matches `EXPOSE 8000` / uvicorn's `--port 8000` in `backend/Dockerfile`.
- `--ingress external` — reachable from the public internet (the frontend and browser both call it directly).
- `--min-replicas 0` — scale-to-zero; costs ~$0 when idle, cold-starts on the next request.
- `--system-assigned` — gives this Container App its own managed identity, used below to grant it narrow permissions on ACR and Key Vault without storing any credential.

**Record the identity's principal ID** — needed for the role assignments in the next two sections:

```bash
IDENTITY_PRINCIPAL_ID=$(az containerapp show \
  --resource-group "$RG" --name "$APP_NAME" \
  --query identity.principalId -o tsv)
echo "$IDENTITY_PRINCIPAL_ID"
```

### Grant the Container App's identity pull access on ACR

```bash
ACR_ID=$(az acr show --name "$ACR_NAME" --query id -o tsv)

az role assignment create \
  --assignee "$IDENTITY_PRINCIPAL_ID" \
  --role AcrPull \
  --scope "$ACR_ID"
```

Role-assignment propagation can lag a minute or two — if a subsequent pull fails with an auth error,
wait and retry before assuming something's misconfigured.

---

## 4. Key Vault + secret references

Key Vault holds the backend's real runtime secrets. The Container App will be wired to **reference**
them (fetch at startup via its managed identity), never to receive them as plaintext in its own config.

Key Vault names must be **globally unique**, 3–24 characters, alphanumeric + hyphens.

```bash
KV_NAME=kv-subaudit-prod

az keyvault create \
  --resource-group "$RG" \
  --name "$KV_NAME" \
  --location "$LOCATION" \
  --enable-rbac-authorization true
```

`--enable-rbac-authorization true` uses Azure RBAC roles (consistent with the `AcrPull` role
assignment above) instead of the older Key Vault access-policy model.

### Grant the Container App's identity read access to secrets

```bash
KV_ID=$(az keyvault show --name "$KV_NAME" --query id -o tsv)

az role assignment create \
  --assignee "$IDENTITY_PRINCIPAL_ID" \
  --role "Key Vault Secrets User" \
  --scope "$KV_ID"
```

`Key Vault Secrets User` only grants `get`/`list` on secrets — least privilege; the Container App
never needs to create or delete secrets.

### Load the required backend secrets

Required per `backend/app/config.py` (the app fails to boot without these — no defaults):

| Secret name in Key Vault | Value |
|---|---|
| `supabase-url` | prod Supabase project URL (`subscription-auditor-prod`, ref `ylwjevannrlsauegwbas`) |
| `supabase-anon-key` | prod anon key |
| `supabase-service-role-key` | prod service role key |
| `supabase-jwt-secret` | prod JWT secret (required config field even though verification actually uses JWKS/ES256 — the app won't boot without it being *present*) |
| `database-url` | prod **Session pooler** connection string (the direct-connection host is IPv6-only and unreachable from many networks) |
| `env` | literal value `production` |
| `cors-allow-origins` | placeholder for now (`https://placeholder.invalid`) — updated once the Static Web App URL exists in step 5 |

Run these **in your own terminal**, not pasted into chat — either interactively (`az keyvault secret
set` will prompt if you omit `--value`) or from a shell variable you've already exported:

```bash
az keyvault secret set --vault-name "$KV_NAME" --name supabase-url --value "$SUPABASE_URL"
az keyvault secret set --vault-name "$KV_NAME" --name supabase-anon-key --value "$SUPABASE_ANON_KEY"
az keyvault secret set --vault-name "$KV_NAME" --name supabase-service-role-key --value "$SUPABASE_SERVICE_ROLE_KEY"
az keyvault secret set --vault-name "$KV_NAME" --name supabase-jwt-secret --value "$SUPABASE_JWT_SECRET"
az keyvault secret set --vault-name "$KV_NAME" --name database-url --value "$DATABASE_URL"
az keyvault secret set --vault-name "$KV_NAME" --name env --value "production"
az keyvault secret set --vault-name "$KV_NAME" --name cors-allow-origins --value "https://placeholder.invalid"
```

(Optional/deferred secrets — `GROQ_API_KEY`, `VAPID_*`, `APPLICATIONINSIGHTS_CONNECTION_STRING` —
have safe defaults in `config.py` and are not needed this session. The `VAPID_*` secrets were
provisioned later, when Web Push landed — see "Web Push and scheduled-job secrets" below.)

### Wire the Container App to reference these secrets

Container Apps has a syntax for a secret backed directly by a Key Vault entry
(`keyvaultref:<secret-uri>,identityref:<managed-identity-resource-id>`), which is then mapped to a
regular environment variable name the app reads.

**Note:** the Container App's own secret *key* names (the left side below, distinct from the Key
Vault secret names they point at) are capped at 20 characters by `az containerapp secret set` — that's
why `supabase-service-role-key` (25 chars) becomes the shorter alias `sb-service-role-key` here, even
though the underlying Key Vault secret keeps its full descriptive name.

```bash
az containerapp secret set \
  --resource-group "$RG" --name "$APP_NAME" \
  --secrets \
    supabase-url="keyvaultref:https://$KV_NAME.vault.azure.net/secrets/supabase-url,identityref:system" \
    supabase-anon-key="keyvaultref:https://$KV_NAME.vault.azure.net/secrets/supabase-anon-key,identityref:system" \
    sb-service-role-key="keyvaultref:https://$KV_NAME.vault.azure.net/secrets/supabase-service-role-key,identityref:system" \
    supabase-jwt-secret="keyvaultref:https://$KV_NAME.vault.azure.net/secrets/supabase-jwt-secret,identityref:system" \
    database-url="keyvaultref:https://$KV_NAME.vault.azure.net/secrets/database-url,identityref:system" \
    env="keyvaultref:https://$KV_NAME.vault.azure.net/secrets/env,identityref:system" \
    cors-allow-origins="keyvaultref:https://$KV_NAME.vault.azure.net/secrets/cors-allow-origins,identityref:system"

az containerapp update \
  --resource-group "$RG" --name "$APP_NAME" \
  --set-env-vars \
    SUPABASE_URL=secretref:supabase-url \
    SUPABASE_ANON_KEY=secretref:supabase-anon-key \
    SUPABASE_SERVICE_ROLE_KEY=secretref:sb-service-role-key \
    SUPABASE_JWT_SECRET=secretref:supabase-jwt-secret \
    DATABASE_URL=secretref:database-url \
    ENV=secretref:env \
    CORS_ALLOW_ORIGINS=secretref:cors-allow-origins
```

This is why the role assignment in the previous section had to happen before this step — Container
Apps validates that the identity can actually read the referenced secret at the time you wire the
reference.

### LLM + chat-cap secrets (added when the chat feature landed)

The chat feature added four environment-driven settings in `backend/app/config.py`. Only two are
strictly load-bearing — `llm-api-key` (chat auth fails without it) and `chat-global-daily-cap` (the
app-wide daily LLM budget; the code default is 5000, but production runs at **2000** by explicit
decision). `llm-provider`/`llm-model` match the code defaults today and are set only to pin
production's provider/model in config rather than riding on a default. They go through the same
Key Vault → secret-reference → env-var mechanism as everything above.

| Key Vault secret | Container App alias | Env var | Value |
|---|---|---|---|
| `llm-provider` | `llm-provider` | `LLM_PROVIDER` | `gemini` |
| `llm-model` | `llm-model` | `LLM_MODEL` | `gemini-flash-lite-latest` |
| `llm-api-key` | `llm-api-key` | `LLM_API_KEY` | the Gemini key (paid Cloud Prepay tier) |
| `chat-global-daily-cap` | `chat-global-cap` | `CHAT_GLOBAL_DAILY_CAP` | `2000` |

Note the alias shortening: `chat-global-daily-cap` is 21 chars, over the Container App secret-key
20-char cap, so its Container App alias is `chat-global-cap` (same reason `supabase-service-role-key`
became `sb-service-role-key` above). The Key Vault secret keeps the full descriptive name.

```bash
az keyvault secret set --vault-name "$KV_NAME" --name llm-provider          --value "gemini"
az keyvault secret set --vault-name "$KV_NAME" --name llm-model             --value "gemini-flash-lite-latest"
az keyvault secret set --vault-name "$KV_NAME" --name llm-api-key           --value "$GEMINI_API_KEY"
az keyvault secret set --vault-name "$KV_NAME" --name chat-global-daily-cap --value "2000"

az containerapp secret set \
  --resource-group "$RG" --name "$APP_NAME" \
  --secrets \
    llm-provider="keyvaultref:https://$KV_NAME.vault.azure.net/secrets/llm-provider,identityref:system" \
    llm-model="keyvaultref:https://$KV_NAME.vault.azure.net/secrets/llm-model,identityref:system" \
    llm-api-key="keyvaultref:https://$KV_NAME.vault.azure.net/secrets/llm-api-key,identityref:system" \
    chat-global-cap="keyvaultref:https://$KV_NAME.vault.azure.net/secrets/chat-global-daily-cap,identityref:system"

az containerapp update \
  --resource-group "$RG" --name "$APP_NAME" \
  --set-env-vars \
    LLM_PROVIDER=secretref:llm-provider \
    LLM_MODEL=secretref:llm-model \
    LLM_API_KEY=secretref:llm-api-key \
    CHAT_GLOBAL_DAILY_CAP=secretref:chat-global-cap
```

### Web Push and scheduled-job secrets (added when notifications landed)

Two independent secrets, with deliberately different distribution. Getting the asymmetry right is the
whole point of this section.

| Secret | Key Vault | Container App alias | Env var | GitHub Actions | Notes |
|---|---|---|---|---|---|
| VAPID private key | `vapid-private-key` | `vapid-private-key` | `VAPID_PRIVATE_KEY` | — | real secret; signs push JWTs |
| VAPID subject | `vapid-subject` | `vapid-subject` | `VAPID_SUBJECT` | — | `mailto:` contact embedded in the signed JWT; not secret, stored here for consistency |
| VAPID **public** key | — | — | — | `PROD_VITE_VAPID_PUBLIC_KEY` | **not a secret**; baked into the frontend bundle at build time |
| Job token | `job-token` | `job-token` | `JOB_TOKEN` | `PROD_JOB_TOKEN` | shared secret; **must match in both places** |

**Why the job token lives in two places:** it is a shared secret between the scheduled GitHub Actions
workflow (which *sends* it in the `X-Job-Token` header) and the backend (which *verifies* it in
constant time via `backend/app/security/compare.py`). Rotating it means updating Key Vault **and** the
GitHub secret in the same sitting — updating one alone breaks every scheduled run.

**Why the VAPID private key lives in only one:** nothing in CI ever signs a push, so GitHub has no
reason to hold it. The public half goes to GitHub only because Vite needs build-time values, not for
confidentiality.

All three aliases fit under the 20-character Container App secret-key cap, so no shortening was needed
here (unlike `sb-service-role-key` and `chat-global-cap` above).

Generate the keypair locally — `cryptography` is already present in `backend/.venv` via
`pyjwt[crypto]`, so this needs no new dependency and no third-party tool ever handles the key. The
VAPID keypair is ECDSA P-256; the public key is the uncompressed EC point (`0x04 || X || Y`, 65 bytes)
and the private key the raw 32-byte scalar, both base64url without padding — the encoding
`py_vapid`/`pywebpush` expect. Expect 87 and 43 characters respectively.

```bash
# Generate (run in your own terminal; do not paste the private key anywhere)
./backend/.venv/bin/python - <<'PY'
import base64
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec
key = ec.generate_private_key(ec.SECP256R1())
pub = key.public_key().public_bytes(
    serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)
priv = key.private_numbers().private_value.to_bytes(32, "big")
b64 = lambda b: base64.urlsafe_b64encode(b).rstrip(b"=").decode()
print("VAPID_PUBLIC_KEY =", b64(pub))
print("VAPID_PRIVATE_KEY =", b64(priv))
PY

# Job token: 384 bits of CSPRNG entropy - it is the only thing in front of a
# publicly routable endpoint, so it must be guessable by no one.
python3 -c "import secrets; print(secrets.token_urlsafe(48))"
```

Note `-o none` on every command below: **`az keyvault secret set` echoes the secret value in its JSON
output by default**, which would leave it in your shell scrollback.

```bash
az keyvault secret set --vault-name "$KV_NAME" --name vapid-private-key --value "$VAPID_PRIVATE_KEY" -o none
az keyvault secret set --vault-name "$KV_NAME" --name vapid-subject     --value "$VAPID_SUBJECT"     -o none
az keyvault secret set --vault-name "$KV_NAME" --name job-token         --value "$JOB_TOKEN"         -o none

az containerapp secret set \
  --resource-group "$RG" --name "$APP_NAME" \
  --secrets \
    vapid-private-key="keyvaultref:https://$KV_NAME.vault.azure.net/secrets/vapid-private-key,identityref:system" \
    vapid-subject="keyvaultref:https://$KV_NAME.vault.azure.net/secrets/vapid-subject,identityref:system" \
    job-token="keyvaultref:https://$KV_NAME.vault.azure.net/secrets/job-token,identityref:system" \
  -o none

az containerapp update \
  --resource-group "$RG" --name "$APP_NAME" \
  --set-env-vars \
    VAPID_PRIVATE_KEY=secretref:vapid-private-key \
    VAPID_SUBJECT=secretref:vapid-subject \
    JOB_TOKEN=secretref:job-token \
  -o none
```

`az containerapp secret set` warns that the app must be restarted for secret changes to take effect;
the `update` that follows creates a new revision, which satisfies that. Verify without ever printing a
value:

```bash
az containerapp show -g "$RG" -n "$APP_NAME" \
  --query "properties.template.containers[0].env[?secretRef].{name:name, ref:secretRef}" -o table
az containerapp revision list -g "$RG" -n "$APP_NAME" \
  --query "[?properties.active].{rev:name, state:properties.runningState}" -o table
```

---

## 5. Static Web Apps (frontend)

Free tier, CDN-backed static hosting purpose-built for SPAs.

**Region note:** Static Web Apps has its own fixed list of supported hosting regions, separate from
general Azure region availability — `germanywestcentral` (used for every other resource above) is not
one of them. Use a supported region instead; `westeurope` is the closest one geographically. This
applies regardless of any subscription-level region-restriction policy.

**Subscription note:** this project's subscription was originally Azure for Students, which restricted
deployments to the five regions listed at the top of this file. It was later upgraded **in place** to
Pay-As-You-Go via the Azure Portal (Cost Management → "Upgrade") — same subscription ID, all
already-provisioned resources untouched, no need to move or recreate anything. The upgrade removed the
`sys.regionrestriction` policy assignment entirely. A ~€10/month subscription-level Budget with alerts
(50/80/100%) was set up in the Portal (Cost Management → Budgets) before creating any further resources,
given Pay-As-You-Go has no spending limit by default.

```bash
SWA_NAME=swa-subscription-auditor

az staticwebapp create \
  --resource-group "$RG" \
  --name "$SWA_NAME" \
  --location westeurope \
  --sku Free
```

**Capture the default URL** — this is the production frontend origin, needed for both of the next two
steps:

```bash
SWA_URL=$(az staticwebapp show --name "$SWA_NAME" --query defaultHostname -o tsv)
echo "https://$SWA_URL"
```

### Update the CORS secret now that the real frontend URL exists

```bash
az keyvault secret set --vault-name "$KV_NAME" --name cors-allow-origins --value "https://$SWA_URL"

# Container Apps caches secretref values per revision — force a new revision to pick up the change:
az containerapp update --resource-group "$RG" --name "$APP_NAME" --revision-suffix cors-update
```

### Supabase Auth redirect allowlist (console step, not CLI)

Google OAuth only redirects to pre-registered URLs. Add `https://<SWA_URL>` to the **prod** Supabase
project's (`subscription-auditor-prod`) Authentication → URL Configuration → Redirect URLs allowlist
in the Supabase dashboard — the same kind of step done for local dev in Session 3.2, now for the real
production URL. Do this now or immediately before first production deploy; Google sign-in will fail
in prod until it's done.

### Turnstile CAPTCHA (production keys)

Dev uses Cloudflare's public always-passing test key; production needs a **real** Turnstile widget so
the login CAPTCHA actually protects the auth form. The site key and secret key live in two different
places:

- **Site key** (public) → GitHub Actions secret `PROD_VITE_TURNSTILE_SITE_KEY`, consumed by
  `frontend.yml` as `VITE_TURNSTILE_SITE_KEY` and baked into the bundle at build time. `Turnstile.tsx`
  falls back to the test key when this is empty, so leaving it unset ships prod with CAPTCHA disabled.
- **Secret key** (private) → the **prod** Supabase project's Authentication → Attack Protection →
  CAPTCHA setting (console step, not CLI), where Supabase's server verifies submitted tokens with
  Cloudflare.

Register the Static Web App default hostname (`<SWA_URL>`, no scheme) on the Cloudflare Turnstile
widget's allowed hostnames. Cloudflare's keys are formatted `0x...` — paste them verbatim.

---

## 6. Application Insights (provisioned only, not instrumented)

Provisions the resource so its connection string exists for later. Actually wiring the backend to
send logs/traces to it is deferred to a later session — this step just creates it.

```bash
APPI_NAME=appi-subscription-auditor-prod

az monitor app-insights component create \
  --resource-group "$RG" \
  --app "$APPI_NAME" \
  --location "$LOCATION" \
  --application-type web
```

Its connection string (for later use) can be fetched anytime with:

```bash
az monitor app-insights component show \
  --resource-group "$RG" --app "$APPI_NAME" \
  --query connectionString -o tsv
```

---

## 7. Verification checklist

Run these and confirm each returns the expected resource (no output / an error means something
above didn't complete):

```bash
az group show --name "$RG" --query name -o tsv
az acr show --name "$ACR_NAME" --query name -o tsv
az containerapp show --resource-group "$RG" --name "$APP_NAME" --query name -o tsv
az keyvault show --name "$KV_NAME" --query name -o tsv
az keyvault secret list --vault-name "$KV_NAME" --query "[].name" -o tsv
az staticwebapp show --name "$SWA_NAME" --query name -o tsv
az monitor app-insights component show --resource-group "$RG" --app "$APPI_NAME" --query name -o tsv

# Confirm the Container App's identity can actually pull from ACR and read Key Vault.
# --all is required here: role assignments scoped to an individual resource (not the whole
# subscription) are silently omitted from the default (non---all) query.
az role assignment list --assignee "$IDENTITY_PRINCIPAL_ID" --all --query "[].{role:roleDefinitionName, scope:scope}" -o table
```

Expect two role assignments listed: `AcrPull` scoped to the ACR, and `Key Vault Secrets User` scoped
to the Key Vault.

---

## 8. Scheduled reminder job (GitHub Actions)

The daily reminder job is triggered by an external scheduler, not an in-process one: the app is
scale-to-zero, so there is no always-on process to run a cron, and running one across horizontally
scaled replicas would fire the job N times. `.github/workflows/reminders.yml` is that scheduler — it
`POST`s to `/api/v1/jobs/run-due` on the deployed backend, authenticating with the shared job token.

**Triggers — and what is deliberately absent.** The workflow runs on exactly two events: a daily
`schedule` cron, and `workflow_dispatch` (the manual "Run workflow" button). It does **not** run on
`push` or `pull_request` — the opposite of `backend.yml`/`frontend.yml` — because the job sends real
Web Push notifications, and firing it on every code change would spam users.

**Schedule and timezone.** The cron is `0 6 * * *` — 06:00 UTC daily. GitHub Actions cron is always
UTC and does not observe daylight saving. Athens is UTC+2 (EET) in winter and UTC+3 (EEST) in summer,
so this fixed UTC hour lands at **08:00 local in winter, 09:00 local in summer**. That one-hour
seasonal drift is expected, not a bug; both are sensible morning delivery times. GitHub also delays
scheduled runs under load — they are best-effort, not precise — which is fine for a once-a-day
reminder. To shift the delivery time, change the UTC hour and re-derive the local window.

**How to trigger a run manually** (the primary operational tool — for the Stage 3 live check, and for
future debugging):

1. GitHub repo → **Actions** tab → **Reminder Job** workflow (left sidebar).
2. **Run workflow** button (top right) → pick the branch → **Run workflow**.
3. Open the run; the step logs the HTTP status and the counts-only JSON summary
   (`due`/`sent`/`skipped_already_sent`/`pruned`/`failed`). A non-2xx status fails the run (red).

**Secrets.** The workflow reads `PROD_JOB_TOKEN` from GitHub Actions secrets (provisioned in Task 1.3,
mirrored from the Key Vault `job-token` the backend verifies). The token is passed as a step env var,
never inlined; the workflow uses no `curl -v` or `set -x`, so the header cannot reach the logs.

**Live end-to-end verification is a Stage 3 step.** The `run-due` endpoint is not in production until
the backend deploy (Task 3.1). Until then a manual dispatch would 404. After the deploy, run a manual
dispatch and confirm a green run with a valid counts summary — that is the real verification, since the
scheduled path cannot be exercised locally.

---

## Reference values for later tasks

Record these — Task 4.2 (CI/CD) and later frontend deploy steps need them:

| Value | Where used |
|---|---|
| `$RG` (resource group name) | every later `az` command targeting these resources |
| `$ACR_NAME` / its login server | Task 4.2's `docker push` target and Container App image updates |
| `$APP_NAME` | Task 4.2's `az containerapp update --image ...` after each backend build |
| `$SWA_NAME` / `$SWA_URL` | Task 4.2's frontend deploy target; also the `VITE_API_BASE_URL` CORS origin |
| `$KV_NAME` | any future secret additions (e.g. `GROQ_API_KEY`, VAPID keys) |
