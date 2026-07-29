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
def test_lead_time_is_never_invented(prompt: str) -> None:
    """A reminder lead time is a user-chosen value like a price or a date, not a
    classification like category — so a missing one is asked for, never guessed.
    Guards the live defect where the model fabricated "5 days" unprompted."""
    low = prompt.lower()
    assert "reminder lead times" in low
    assert "how many days they want" in low
    # A vague comparative must not be read as implying a number.
    assert "never pick a number yourself" in low
    assert '"earlier"' in low


@_prompt
def test_ambiguous_subscription_match_requires_confirmation(prompt: str) -> None:
    """Guards the live defect where "Pokemon golf" was silently applied to an
    existing "Pokemon go". The rule is about *which* subscription an action lands
    on, so it must also say it applies to non-destructive edits — otherwise it
    collapses into the destructive-confirmation rule and the silent wrong-target
    edit stays possible."""
    low = prompt.lower()
    # Short fragments only — the prompt hard-wraps at ~76 cols, so anything
    # longer risks straddling a line break and never matching.
    assert "identify exactly one of them" in low
    assert "ask which one they mean" in low
    # The load-bearing clause: one similar candidate is NOT a match. Without this
    # the model reads "only one plausible option" as unambiguous and edits it,
    # which is precisely how the live check failed before this wording.
    assert "even if exactly one of their subscriptions looks similar" in low
    assert "being the only similar name does not make it the intended one" in low
    assert "non-destructive edits too" in low


@_prompt
def test_ambiguous_match_rule_does_not_gate_every_edit(prompt: str) -> None:
    """The rule must not be read as "confirm before every edit" — an obvious,
    exact reference still acts directly. Without this the fix would trade a wrong-
    target edit for a needless confirmation on every ordinary one."""
    low = prompt.lower()
    assert "matches exactly one subscription, just act" in low
    assert "not a licence to ask for" in low


@_prompt
def test_destructive_confirmation_rule_still_distinct(prompt: str) -> None:
    """The pre-existing destructive-action discipline must survive unchanged and
    stay separate from the new targeting rule (whether to act vs what to act on)."""
    low = prompt.lower()
    assert "confirmation discipline for destructive actions" in low
    assert "clear affirmative" in low
    assert "separate from the confirmation you must get before destructive" in low


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


# --------------------------------------------------------------------------
# Two rules added after live testing surfaced the behaviours they prevent:
# the assistant answered "why is X uncategorised?" by silently updating the
# category, and it rendered a table through render_table AND repeated the same
# rows as markdown in the same reply.
#
# Fragments are chosen to sit on ONE line: the prompt hard-wraps at ~76 columns,
# so an assertion straddling a line break can never match.
# --------------------------------------------------------------------------
def test_a_question_does_not_authorise_a_write():
    prompt = build_system_prompt("en")
    assert "A question is not an instruction" in prompt
    assert (
        "Answer it in words. Do not call a tool that adds, updates, cancels, or deletes" in prompt
    )
    # The concrete case that was observed failing, named outright — an abstract
    # criterion gets re-evaluated by the judgement that was already wrong.
    assert "by explaining why, never by categorising it." in prompt


def test_rendered_data_is_not_also_repeated_as_text():
    prompt = build_system_prompt("en")
    assert "Present data once" in prompt
    assert "rendering is your answer" in prompt
    assert "as a markdown table in the same reply" in prompt


def test_new_rules_do_not_disturb_the_category_or_grounding_rules():
    """Both additions sit next to rules that earlier tasks fixed defects with, so
    lock in that those still read as before."""
    prompt = build_system_prompt("en")
    # Category remains classification-not-fabrication (Task 2.3).
    assert "Category is different, and you should set it" in prompt
    assert 'Assigning "streaming" to Netflix is correct classification, not invention.' in prompt
    # Grounding is unchanged.
    assert (
        "Grounding: every figure, chart, or table you present must come from the result" in prompt
    )
    # A question must not become a licence to skip asking for missing values.
    assert "Never invent, guess, or assume a price, a billing cycle, or a" in prompt
