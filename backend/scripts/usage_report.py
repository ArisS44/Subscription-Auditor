"""Operator-only daily LLM usage report. Prints per-day request counts, token
totals, and an estimated cost from the `llm_usage` table. Not exposed anywhere in
the app — it reads the app-wide (and optionally per-user) counters directly.

Run from the backend/ directory so it loads backend/.env:
    .venv/bin/python scripts/usage_report.py            # last 30 days, app-wide
    .venv/bin/python scripts/usage_report.py --days 7   # last 7 days
    .venv/bin/python scripts/usage_report.py --by-user  # today's per-user split

No message content is ever stored or shown — only aggregate counts. Cost is an
estimate: update the per-1M-token rates below if Google changes Gemini pricing.
"""

import argparse
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.config import settings  # noqa: E402
from app.db.pool import close_pool, create_pool, get_pool  # noqa: E402

# Estimated gemini-3.5-flash pricing (USD per 1M tokens). Verify against
# https://ai.google.dev/pricing — thinking tokens are billed as output.
PRICE_INPUT_PER_1M = 0.30
PRICE_OUTPUT_PER_1M = 2.50


def _cost(input_tokens: int, output_tokens: int) -> float:
    return input_tokens / 1e6 * PRICE_INPUT_PER_1M + output_tokens / 1e6 * PRICE_OUTPUT_PER_1M


async def _app_wide(days: int) -> None:
    async with get_pool().acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT day, request_count, input_tokens, output_tokens
            FROM llm_usage
            WHERE user_id IS NULL AND day >= (CURRENT_DATE - $1::int)
            ORDER BY day DESC
            """,
            days,
        )
    print(f"\nApp-wide LLM usage (last {days} days) — model {settings.llm_model}")
    print(f"{'day':<12}{'requests':>10}{'in_tokens':>14}{'out_tokens':>14}{'est_cost_usd':>14}")
    print("-" * 64)
    tot_r = tot_i = tot_o = 0
    for r in rows:
        c = _cost(r["input_tokens"], r["output_tokens"])
        print(
            f"{str(r['day']):<12}{r['request_count']:>10}{r['input_tokens']:>14}"
            f"{r['output_tokens']:>14}{c:>14.4f}"
        )
        tot_r += r["request_count"]
        tot_i += r["input_tokens"]
        tot_o += r["output_tokens"]
    print("-" * 64)
    print(f"{'TOTAL':<12}{tot_r:>10}{tot_i:>14}{tot_o:>14}{_cost(tot_i, tot_o):>14.4f}")
    print(f"\n(rates: ${PRICE_INPUT_PER_1M}/1M in, ${PRICE_OUTPUT_PER_1M}/1M out — estimate)\n")


async def _by_user() -> None:
    async with get_pool().acquire() as conn:
        rows = await conn.fetch("""
            SELECT user_id, request_count, input_tokens, output_tokens
            FROM llm_usage
            WHERE user_id IS NOT NULL AND day = CURRENT_DATE
            ORDER BY request_count DESC
            """)
    print(f"\nPer-user usage today ({len(rows)} users)")
    print(f"{'user_id':<38}{'requests':>10}{'est_cost_usd':>14}")
    print("-" * 62)
    for r in rows:
        print(
            f"{str(r['user_id']):<38}{r['request_count']:>10}"
            f"{_cost(r['input_tokens'], r['output_tokens']):>14.4f}"
        )
    print()


async def main() -> None:
    parser = argparse.ArgumentParser(description="Operator LLM usage report")
    parser.add_argument("--days", type=int, default=30, help="days of history (app-wide)")
    parser.add_argument("--by-user", action="store_true", help="today's per-user breakdown")
    args = parser.parse_args()

    await create_pool()
    try:
        if args.by_user:
            await _by_user()
        else:
            await _app_wide(args.days)
    finally:
        await close_pool()


if __name__ == "__main__":
    asyncio.run(main())
