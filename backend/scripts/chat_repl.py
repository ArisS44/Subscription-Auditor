"""Interactive Apollon chat REPL against the real engine — for manual message-by-
message testing before the frontend chat surface exists. Creates a throwaway dev
user + conversation, streams each turn (text + which tools fired), and cleans up
the user on exit.

Run from the backend/ directory (loads backend/.env):
    .venv/bin/python scripts/chat_repl.py

Type messages and press Enter. Commands: /seed  (add a few sample subscriptions),
/lang en|el|auto,  /quit.
"""

import asyncio
import sys
import uuid
from pathlib import Path

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.config import settings  # noqa: E402
from app.db import chat as chat_db  # noqa: E402
from app.db.pool import close_pool, create_pool, get_pool  # noqa: E402
from app.db.rls import rls_connection  # noqa: E402
from app.deps import verify_token  # noqa: E402
from app.models.subscription import SubscriptionCreate  # noqa: E402
from app.services import chat as chat_svc  # noqa: E402
from app.services import subscription as sub_svc  # noqa: E402

_ADMIN = {
    "apikey": settings.supabase_service_role_key,
    "Authorization": f"Bearer {settings.supabase_service_role_key}",
}


async def _create_user():
    email = f"repl-{uuid.uuid4().hex[:12]}@example.com"
    pw = "Test-Password-123!"
    async with httpx.AsyncClient(timeout=15) as c:
        r = await c.post(
            f"{settings.supabase_url}/auth/v1/admin/users",
            headers=_ADMIN,
            json={"email": email, "password": pw, "email_confirm": True},
        )
        r.raise_for_status()
        uid = r.json()["id"]
        r2 = await c.post(
            f"{settings.supabase_url}/auth/v1/token?grant_type=password",
            headers={"apikey": settings.supabase_anon_key},
            json={"email": email, "password": pw},
        )
        r2.raise_for_status()
        return uid, r2.json()["access_token"]


async def _seed(claims):
    for name, price, cat in [
        ("Netflix", "12.99", "streaming"),
        ("Spotify", "9.99", "streaming"),
        ("ChatGPT Plus", "20.00", "ai_tool"),
    ]:
        await sub_svc.create_subscription(
            claims,
            SubscriptionCreate(
                name=name,
                price=price,
                currency="EUR",
                category=cat,
                billing_cycle="monthly",
                start_date="2026-01-15",
            ),
        )
    print("  (seeded Netflix, Spotify, ChatGPT Plus)")


async def main():
    settings.chat_user_per_minute = 100000
    await create_pool()
    uid, token = await _create_user()
    claims = verify_token(token)
    async with rls_connection(claims) as conn:
        conv = str((await chat_db.insert_conversation(conn, uid, None))["id"])
    print(f"Apollon REPL — model {settings.llm_model}. Type a message, or /seed /lang /quit.\n")
    try:
        while True:
            try:
                text = await asyncio.to_thread(input, "you> ")
            except (EOFError, KeyboardInterrupt):
                break
            text = text.strip()
            if not text:
                continue
            if text == "/quit":
                break
            if text == "/seed":
                await _seed(claims)
                continue
            if text.startswith("/lang"):
                lang = text.split()[-1]
                async with rls_connection(claims) as conn:
                    await conn.execute(
                        "UPDATE profiles SET preferred_language=$1 WHERE id=$2", lang, uid
                    )
                print(f"  (language set to {lang})")
                continue
            client = httpx.AsyncClient(timeout=httpx.Timeout(60.0, connect=10.0))
            print("apollon> ", end="", flush=True)
            tools_used = []
            try:
                async for ev in chat_svc.stream_turn(claims, conv, text, client=client):
                    if ev["type"] == "delta":
                        print(ev["text"], end="", flush=True)
                    elif ev["type"] == "tool":
                        tools_used.append(ev["name"])
                    elif ev["type"] == "structured":
                        p = ev["payload"]
                        cur = f" {p['currency']}" if p.get("currency") else ""
                        if "chart_type" in p:  # chart: show its data points
                            title = f" — {p['title']}" if p.get("title") else ""
                            print(f"\n  [chart: {p['chart_type']}{title}]")
                            for pt in p.get("points", []):
                                print(f"      {pt['label']}: {pt['value']}{cur}")
                        else:  # table: show columns + rows
                            title = f" — {p['title']}" if p.get("title") else ""
                            print(f"\n  [table{title}]")
                            print("      " + " | ".join(p.get("columns", [])))
                            for row in p.get("rows", []):
                                print("      " + " | ".join(str(c) for c in row))
                        print("  ", end="")
                    elif ev["type"] == "error":
                        print(f"\n  [error: {ev.get('reason')}] {ev.get('message')}", end="")
            finally:
                await client.aclose()
            if tools_used:
                print(f"\n  · tools: {tools_used}")
            print()
    finally:
        async with get_pool().acquire() as conn:
            await conn.execute("DELETE FROM llm_usage WHERE user_id=$1", uid)
        async with httpx.AsyncClient(timeout=15) as c:
            await c.delete(f"{settings.supabase_url}/auth/v1/admin/users/{uid}", headers=_ADMIN)
        await close_pool()
        print("\n(cleaned up test user)")


if __name__ == "__main__":
    asyncio.run(main())
