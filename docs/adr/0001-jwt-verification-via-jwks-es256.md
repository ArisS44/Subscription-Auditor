# ADR 0001: Verify Supabase JWTs via JWKS/ES256, not the HS256 shared secret

## Status
Accepted

## Context
The backend needs to independently verify a caller's Supabase-issued access token on every
request (the `Authorization: Bearer <jwt>` header) without calling back to Supabase's API each
time. `backend/.env` provisions `SUPABASE_JWT_SECRET`, which strongly suggested HS256
(symmetric, shared-secret) verification: decode with `jwt.decode(token, secret,
algorithms=["HS256"])`.

Before implementing against that assumption, a real token was minted for this Supabase project
via the Auth Admin API (pre-confirmed test user, password grant) and its header inspected without
verification. The header was:

```json
{"alg": "ES256", "kid": "73221295-1c4f-4e55-969f-98db597a8239", "typ": "JWT"}
```

This project issues **ES256** (asymmetric, elliptic-curve) tokens, not HS256. Newer Supabase
projects default to asymmetric signing keys; `SUPABASE_JWT_SECRET` is populated regardless (it's
part of the standard env template) but is not the mechanism this project's tokens actually use.

## Decision
Verify tokens via JWKS: fetch the public signing key from
`<SUPABASE_URL>/auth/v1/.well-known/jwks.json` using `jwt.PyJWKClient` (which caches keys by
`kid`), then `jwt.decode(token, signing_key.key, algorithms=["ES256"], audience="authenticated",
issuer=f"{SUPABASE_URL}/auth/v1")`. `SUPABASE_JWT_SECRET` is not used by the verification path.

## Consequences
- Verification only ever needs the *public* key — the backend can never forge tokens, which
  HS256's shared secret would technically allow if leaked or misused.
- Adds one dependency: `pyjwt[crypto]` (for the `cryptography` backend ES256 needs) plus `httpx`
  for the JWKS fetch inside `PyJWKClient`.
- If this Supabase project's JWT signing method is ever changed (dashboard: Settings → API →
  JWT Keys), the hardcoded `algorithms=["ES256"]` in `app/deps.py` would need to change too —
  there's no automatic fallback to HS256. Acceptable for now since the algorithm is a protocol
  constant tied to a real, verified fact about this project, not a guess.
- `docs/APP_DESCRIPTION.md`/`.env.example` still list `SUPABASE_JWT_SECRET` since it's part of
  Supabase's standard project credentials; a comment could be added there noting it's unused by
  the current verification path if that becomes confusing later.
