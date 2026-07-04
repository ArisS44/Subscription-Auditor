import jwt
from fastapi import Header, HTTPException, status

from app.config import settings

# Verified against a real token minted by this Supabase project: header is
# {"alg": "ES256", ...}, i.e. asymmetric signing via JWKS, not the HS256
# shared secret. PyJWKClient fetches and caches the public signing key by
# `kid` from the JWKS endpoint so we can verify without ever holding a
# private/shared secret capable of forging tokens.
_jwks_client = jwt.PyJWKClient(
    f"{settings.supabase_url}/auth/v1/.well-known/jwks.json", cache_keys=True
)

_ISSUER = f"{settings.supabase_url}/auth/v1"


class AuthError(HTTPException):
    """Raised on any JWT failure. Message is intentionally generic so it
    cannot act as a user-enumeration or token-state oracle — missing,
    malformed, expired, and signature-invalid tokens all look identical
    to the caller."""

    def __init__(self) -> None:
        super().__init__(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authentication credentials",
        )


def _extract_bearer_token(authorization: str | None) -> str:
    if not authorization or not authorization.startswith("Bearer "):
        raise AuthError()
    token = authorization.removeprefix("Bearer ").strip()
    if not token:
        raise AuthError()
    return token


def verify_token(token: str) -> dict:
    """Verify a Supabase-issued access token and return its claims.

    Factored out from the FastAPI dependency so tests (and any future
    non-HTTP callers) can verify a raw token string without going through
    the `Authorization` header parsing.
    """
    try:
        signing_key = _jwks_client.get_signing_key_from_jwt(token)
        claims = jwt.decode(
            token,
            signing_key.key,
            algorithms=["ES256"],
            audience="authenticated",
            issuer=_ISSUER,
        )
    except jwt.PyJWTError:
        raise AuthError() from None
    if "sub" not in claims:
        raise AuthError()
    return claims


async def get_current_claims(authorization: str | None = Header(default=None)) -> dict:
    token = _extract_bearer_token(authorization)
    return verify_token(token)
