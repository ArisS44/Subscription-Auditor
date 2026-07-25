"""Prompt-discipline regression tests.

These guard the behavioural rules the live chat surface depends on but which a
stubbed LLM cannot exercise: the assistant must never claim a fabricated success,
must ask for missing write details instead of inventing them, and must never leak
an internal tool/function name to the user. The rules live in the shared identity
block, so both the standard and onboarding variants must carry them.
"""

import pytest

from app.services.prompts import build_system_prompt

_VARIANTS = {
    "standard-auto": build_system_prompt("auto", onboarding=False),
    "onboarding-auto": build_system_prompt("auto", onboarding=True),
    "standard-en": build_system_prompt("en", onboarding=False),
    "onboarding-el": build_system_prompt("el", onboarding=True),
}
_prompt = pytest.mark.parametrize("prompt", _VARIANTS.values(), ids=_VARIANTS.keys())


# The prompt hard-wraps at ~76 cols, so assertions match short fragments that do
# not straddle a line break rather than long phrases.
@_prompt
def test_no_fabricated_success_rule_present(prompt: str) -> None:
    low = prompt.lower()
    # Must forbid claiming an action happened without a real tool result.
    assert "never claim" in low
    assert "successful result" in low


@_prompt
def test_ask_dont_invent_rule_present(prompt: str) -> None:
    low = prompt.lower()
    assert "ask the user for those details" in low
    # Must forbid inventing a price/billing/date the user did not give — the
    # financially-material values that must be asked for, not filled in.
    assert "never invent" in low
    assert "price, a billing cycle, or a" in low


@_prompt
def test_category_is_classification_not_fabrication(prompt: str) -> None:
    """The corrected rule: category is a classification the model SHOULD assign to
    a recognisable service, distinct from the price/date it must never invent.
    This guards the chat-created-subscription-uncategorised defect from
    regressing."""
    low = prompt.lower()
    assert "category is different" in low
    assert "you should set it" in low
    # The five-value taxonomy is named so the model classifies against it.
    assert "streaming" in low and "cloud_storage" in low
    # But price/date invention protection is explicitly preserved.
    assert "unknowable and financially material" in low


@_prompt
def test_tool_names_are_hidden_rule_present(prompt: str) -> None:
    low = prompt.lower()
    # Must forbid surfacing internal tool/function names or "commands".
    assert "internal implementation details" in low
    assert "never mention" in low
    assert "function" in low


@_prompt
def test_current_date_present_in_iso_form(prompt: str) -> None:
    from datetime import date

    today = date.today().isoformat()
    assert today in prompt
    assert "resolve" in prompt.lower()  # the relative-date resolution directive


@_prompt
def test_current_date_does_not_license_defaulting_a_missing_date(prompt: str) -> None:
    """The date is context for resolving a relative date the user gave, not a
    default for one they omitted — the wording must keep the anti-fabrication rule
    intact (guards the 2.7 fix from being read as permission to default 'today')."""
    low = prompt.lower()
    assert "does not permit" in low
    assert "still ask for it" in low


def test_current_date_is_computed_per_call_not_frozen_at_import(monkeypatch) -> None:
    """The date must track the clock at call time, so a long-running server does
    not keep reporting the day it booted. Patch date.today() and confirm the new
    value appears — proving it is not a constant captured at module import."""
    import datetime as _dt

    from app.services import prompts as prompts_mod

    class _FixedDate(_dt.date):
        @classmethod
        def today(cls):
            return cls(2099, 1, 2)

    monkeypatch.setattr(prompts_mod, "date", _FixedDate)
    assert "2099-01-02" in build_system_prompt("en")


def test_no_registry_tool_name_appears_verbatim_in_prompt() -> None:
    """The prompt talks *about* tools abstractly; it must not hardcode any actual
    registry tool name (which would both leak internals and couple the prompt to
    the registry). Guards against a future edit pasting real tool names in."""
    from app.services import tools as tools_mod

    prompt = build_system_prompt("auto").lower()
    for name in tools_mod.registered_tool_names():
        assert name.lower() not in prompt, f"tool name {name!r} leaked into system prompt"
