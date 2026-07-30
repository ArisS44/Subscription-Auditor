from datetime import date
from decimal import Decimal

from app.models.push import NotificationPayload

# Server-composed, user-facing notification copy in both supported languages. Kept
# in its own module — never inline in the reminder engine — so the strings stay
# reviewable and translatable in one place, and so the logic that decides a
# reminder is warranted does not also own the words. Every string is rendered from
# parameters, never concatenated ad hoc.
#
# `preferred_language` comes from profiles ('auto' | 'en' | 'el'). 'auto' resolves
# to English: 'auto' means "detect from the user's message", and a scheduled
# reminder has no user message to detect from.

# Date formats chosen per language rather than a single locale-neutral one, so the
# copy reads naturally: e.g. "24 Jul 2026" vs "24/07/2026".
_DATE_FORMATS = {"en": "%d %b %Y", "el": "%d/%m/%Y"}

_RENEWAL_TEMPLATES = {
    "en": {
        "title": "Upcoming renewal",
        # e.g. "Claude Pro renews on 24 Jul 2026 for USD 20.00."
        "body": "{name} renews on {when} for {currency} {price}.",
    },
    "el": {
        "title": "Επερχόμενη ανανέωση",
        # e.g. "Η συνδρομή Claude Pro ανανεώνεται στις 24/07/2026 για 20,00 USD."
        # Leads with "Η συνδρομή" rather than an article on {name}: Greek articles
        # carry gender, and a subscription name is arbitrary (η Netflix, ο
        # Απόλλωνας), so any hardcoded article is wrong for some names.
        "body": "Η συνδρομή {name} ανανεώνεται στις {when} για {price} {currency}.",
    },
}


def resolve_language(preferred_language: str | None) -> str:
    """Map a profile's preferred_language to a concrete copy language. Anything
    that is not an explicit 'el' — including 'auto', None, or an unexpected value —
    resolves to English, the documented default."""
    return "el" if preferred_language == "el" else "en"


def _format_price(price: Decimal, lang: str) -> str:
    """Two-decimal-place string for the amount, with the decimal separator the
    language actually uses — Greek writes 20,00 where English writes 20.00, and the
    rest of the app gets this from `Intl` on the frontend.

    Done by substitution rather than the `locale` module, which is process-global
    and would make a per-user format depend on interpreter-wide state.

    Currency is shown as its ISO code (positioned per language in the template)
    rather than a symbol — the code is unambiguous and needs no per-currency symbol
    table."""
    text = f"{price:.2f}"
    return text.replace(".", ",") if lang == "el" else text


def render_renewal_reminder(
    preferred_language: str | None,
    *,
    name: str,
    price: Decimal,
    currency: str,
    renewal_date: date,
) -> NotificationPayload:
    """Build the renewal-reminder NotificationPayload in the user's language. The
    figures are the user's own subscription data, delivered encrypted to their own
    device."""
    lang = resolve_language(preferred_language)
    template = _RENEWAL_TEMPLATES[lang]
    when = renewal_date.strftime(_DATE_FORMATS[lang])
    body = template["body"].format(
        name=name, when=when, currency=currency, price=_format_price(price, lang)
    )
    return NotificationPayload(title=template["title"], body=body)
