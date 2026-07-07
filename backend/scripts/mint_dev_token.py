"""Mint a short-lived access token for a throwaway dev user, for manually
poking the API in Swagger UI (/docs). Prints the token to stdout.

Run from the backend/ directory so it loads backend/.env:
    uv run python scripts/mint_dev_token.py

This talks to the DEV Supabase project only (whatever SUPABASE_URL in .env
points at). The user it creates is a random test account; delete it later from
the dashboard if you like, or leave it — it's harmless.
"""

import asyncio
import uuid

import httpx

from app.config import settings

_ADMIN_HEADERS = {
    "apikey": settings.supabase_service_role_key,
    "Authorization": f"Bearer {settings.supabase_service_role_key}",
}


async def main() -> None:
    email = f"dev-{uuid.uuid4().hex[:12]}@example.com"
    password = "Dev-Password-123!"
    async with httpx.AsyncClient(timeout=15) as client:
        # Create a pre-confirmed user (skips the email-confirmation step).
        r = await client.post(
            f"{settings.supabase_url}/auth/v1/admin/users",
            headers=_ADMIN_HEADERS,
            json={"email": email, "password": password, "email_confirm": True},
        )
        r.raise_for_status()

        # Log in to get an access token.
        r2 = await client.post(
            f"{settings.supabase_url}/auth/v1/token?grant_type=password",
            headers={"apikey": settings.supabase_anon_key},
            json={"email": email, "password": password},
        )
        r2.raise_for_status()
        token = r2.json()["access_token"]

    print("\n=== Dev access token (valid ~1 hour) ===")
    print(token)
    print("\nIn Swagger (/docs): click 'Authorize', paste the token, click Authorize.")
    print(f"(test user: {email})\n")


if __name__ == "__main__":
    asyncio.run(main())
