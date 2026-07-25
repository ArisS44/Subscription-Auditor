import json
import re

from app.db import service_guides as guides_db
from app.db.rls import rls_connection

# The guidance lookup and its two-tier trust model. This is the security core of
# the feature:
#   - a curated service_guides row is verified data the project controls, so its
#     cancel_url may be carried as a real link;
#   - when no curated row exists, the result is marked unverified and carries NO
#     url — the model then supplies general guidance that the frontend renders as
#     plainly-labelled unverified text. A model-generated cancellation URL is an
#     arbitrary attacker-influenceable destination, so it must never be presented
#     as a trusted link.
# The backend never fetches either URL — it returns the curated one as data only.

# Provenance markers the frontend keys its rendering on. Curated => may linkify
# the cancel_url; unverified => render as plain text, labelled unverified.
PROVENANCE_CURATED = "curated"
PROVENANCE_UNVERIFIED = "unverified"


def _slugify(service: str) -> str:
    """Normalise a free-text service name to the service_key slug convention:
    lowercase, non-alphanumerics collapsed to single underscores, trimmed. E.g.
    'Disney+' -> 'disney', 'ChatGPT Plus' -> 'chatgpt_plus'. Only used to attempt
    a slug match; the raw name is also matched against display_name, so an
    imperfect slug still resolves via the name."""
    return re.sub(r"_+", "_", re.sub(r"[^a-z0-9]+", "_", service.lower())).strip("_")


def _json_field(value: object) -> object:
    """asyncpg returns JSONB columns as raw strings here (no json codec is set on
    the pool). Parse them so the tool result carries a real list/object, not a
    JSON-encoded string."""
    if isinstance(value, str):
        return json.loads(value)
    return value


async def get_guide(claims: dict, service: str) -> dict:
    """Return curated cancellation guidance for `service` if a verified row
    exists, otherwise an unverified-tier result instructing the model to supply
    general guidance without a fabricated link. Always carries explicit
    provenance so the frontend renders each tier correctly."""
    service_key = _slugify(service)
    async with rls_connection(claims) as conn:
        row = await guides_db.get_guide(conn, service_key=service_key, display_name=service.strip())

    if row is not None:
        return {
            "provenance": PROVENANCE_CURATED,
            "service_key": row["service_key"],
            "display_name": row["display_name"],
            "category": row["category"],
            # Verified, project-controlled destinations. The frontend may render
            # these as real links; the backend never fetches them.
            "cancel_url": row["cancel_url"],
            "signup_url": row["signup_url"],
            "cancel_steps": _json_field(row["cancel_steps"]),
            "plans": _json_field(row["plans"]),
        }

    # Unverified tier: no curated row. No URL is returned — any link the model
    # produces in its prose is unverified and the frontend must not linkify it.
    return {
        "provenance": PROVENANCE_UNVERIFIED,
        "query": service.strip(),
        "cancel_url": None,
        "note": (
            "No curated guide exists for this service. Provide general "
            "cancellation guidance from your own knowledge, phrased cautiously, "
            "and do NOT state a specific cancellation URL as if it were verified. "
            "This guidance is unverified."
        ),
    }
