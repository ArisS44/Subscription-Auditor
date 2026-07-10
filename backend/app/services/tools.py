"""In-process tool registry + dispatcher for the Apollon chat loop.

Design: a registry (name -> ToolSpec) with a dispatcher that looks up a tool,
validates the model-supplied arguments against the tool's Pydantic model, and
only then calls the handler. Adding a capability is registering a ToolSpec —
never editing an if/elif chain in the chat loop; a later task's loop calls
`dispatch` / `tool_definitions` generically.

Security posture:
- Every tool-call payload is validated by Pydantic before anything executes; a
  malformed payload returns a clean, LLM-consumable error (never a partial
  execution, never a raw stack trace to the model).
- Handlers call the existing services with the caller's `claims`, which run
  through `rls_connection(claims)` — so a tool physically cannot cross a user
  boundary. There is deliberately no redundant manual ownership check; RLS is the
  enforcement mechanism.
- `render_chart` / `render_table` output renders in the chat UI, so their
  validators reject bad shapes, non-finite numbers, and HTML/script-bearing or
  oversized labels (defense in depth — the frontend also sanitizes). They enforce
  *structure* only; whether the numbers are real (derived from a `get_analytics`
  call this turn) is the chat loop's grounding job, not this layer's.
"""

import json
import math
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import date
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, BeforeValidator, Field, ValidationError, model_validator

from app.models.analytics import AnalyticsResponse
from app.models.profile import ProfileResponse, ProfileUpdate
from app.models.subscription import (
    Category,
    Currency,
    SubscriptionCreate,
    SubscriptionListResponse,
    SubscriptionResponse,
    SubscriptionStatus,
    SubscriptionUpdate,
)
from app.services import analytics as analytics_svc
from app.services import profile as profile_svc
from app.services import subscription as sub_svc
from app.services.llm import ToolDef
from app.services.profile import ProfileNotFoundError
from app.services.subscription import SubscriptionNotFoundError


# ---------------------------------------------------------------------------
# Result + registry types.
# ---------------------------------------------------------------------------
@dataclass
class ToolResult:
    """Outcome of a dispatch. `ok=False` carries an LLM-consumable error string in
    `content["error"]`; the chat loop turns either into a role="tool" message."""

    ok: bool
    content: dict

    @classmethod
    def success(cls, data: dict) -> "ToolResult":
        return cls(True, data)

    @classmethod
    def failure(cls, message: str) -> "ToolResult":
        return cls(False, {"error": message})


@dataclass
class ToolSpec:
    name: str
    description: str
    args_model: type[BaseModel]
    handler: Callable[[dict, BaseModel], Awaitable[dict]]


_REGISTRY: dict[str, ToolSpec] = {}


def register(spec: ToolSpec) -> None:
    """Register (or replace) a tool. This is the only entry point — adding a tool
    is a call to register, not an edit to the dispatcher or chat loop."""
    _REGISTRY[spec.name] = spec


def get_tool(name: str) -> ToolSpec | None:
    return _REGISTRY.get(name)


def registered_tool_names() -> list[str]:
    return sorted(_REGISTRY)


def tool_definitions() -> list[ToolDef]:
    """The provider-neutral tool definitions for the LLM layer — each tool's
    Pydantic model rendered as JSON Schema. The adapter wraps these per provider."""
    return [
        ToolDef(name=s.name, description=s.description, parameters=s.args_model.model_json_schema())
        for s in _REGISTRY.values()
    ]


def _format_validation_error(name: str, exc: ValidationError) -> str:
    parts = []
    for err in exc.errors():
        loc = ".".join(str(p) for p in err["loc"]) or "(root)"
        parts.append(f"{loc}: {err['msg']}")
    return f"Invalid arguments for {name}: " + "; ".join(parts)


async def dispatch(name: str, arguments: dict | str | None, claims: dict) -> ToolResult:
    """Validate `arguments` against the named tool's model, then execute it under
    the caller's claims. Returns a clean ToolResult in every non-crash path."""
    spec = _REGISTRY.get(name)
    if spec is None:
        return ToolResult.failure(f"Unknown tool: {name!r}")

    if arguments is None or arguments == "":
        arguments = {}
    if isinstance(arguments, str):
        try:
            arguments = json.loads(arguments)
        except json.JSONDecodeError:
            return ToolResult.failure(f"Arguments for {name} were not valid JSON")
    if not isinstance(arguments, dict):
        return ToolResult.failure(f"Arguments for {name} must be a JSON object")

    try:
        args = spec.args_model.model_validate(arguments)
    except ValidationError as exc:
        return ToolResult.failure(_format_validation_error(name, exc))

    try:
        data = await spec.handler(claims, args)
    except (SubscriptionNotFoundError, ProfileNotFoundError):
        # Includes the RLS case: another user's row is invisible, so it reads as
        # not-found rather than forbidden — existence is never leaked.
        return ToolResult.failure(f"{name}: the requested record was not found")
    return ToolResult.success(data)


# ---------------------------------------------------------------------------
# render_chart / render_table payload validators (most security-sensitive).
# ---------------------------------------------------------------------------
_LABEL_MAX = 120
_MAX_CHART_POINTS = 100
_MAX_TABLE_ROWS = 500
_MAX_TABLE_COLS = 20


def _clean_label(value: object) -> str:
    """Length-cap and reject markup/control characters in a display string, so no
    HTML/script-bearing content reaches the chat UI through a tool payload."""
    if not isinstance(value, str):
        raise ValueError("must be a string")
    s = value.strip()
    if not s:
        raise ValueError("must not be empty")
    if len(s) > _LABEL_MAX:
        raise ValueError(f"must be at most {_LABEL_MAX} characters")
    if "<" in s or ">" in s:
        raise ValueError("must not contain HTML markup")
    if any(ord(c) < 32 for c in s):
        raise ValueError("must not contain control characters")
    return s


def _finite_number(value: object) -> float:
    """Accept only a real, finite number — reject bools, strings, NaN, and inf."""
    if isinstance(value, bool) or not isinstance(value, int | float):
        raise ValueError("must be a number")
    f = float(value)
    if not math.isfinite(f):
        raise ValueError("must be a finite number")
    return f


def _clean_cell(value: object) -> str | float:
    """A table cell is either display text (sanitized) or a finite number."""
    if isinstance(value, bool):
        raise ValueError("must be text or a number")
    if isinstance(value, int | float):
        return _finite_number(value)
    return _clean_label(value)


SafeLabel = Annotated[str, BeforeValidator(_clean_label)]
FiniteNumber = Annotated[float, BeforeValidator(_finite_number)]
Cell = Annotated[str | float, BeforeValidator(_clean_cell)]


class ChartPoint(BaseModel):
    label: SafeLabel
    value: FiniteNumber


class RenderChartArgs(BaseModel):
    """A presentation-only chart payload. chart_type is a fixed enum; every value
    is a finite number; every label is sanitized and length-capped."""

    chart_type: Literal["bar", "column", "line", "pie", "donut"]
    title: SafeLabel | None = None
    currency: Currency | None = None
    points: list[ChartPoint] = Field(min_length=1, max_length=_MAX_CHART_POINTS)


class RenderTableArgs(BaseModel):
    """A presentation-only table payload. Header/cell strings are sanitized; every
    row must have exactly one cell per column."""

    title: SafeLabel | None = None
    columns: list[SafeLabel] = Field(min_length=1, max_length=_MAX_TABLE_COLS)
    rows: list[list[Cell]] = Field(default_factory=list, max_length=_MAX_TABLE_ROWS)

    @model_validator(mode="after")
    def _rows_match_columns(self) -> "RenderTableArgs":
        width = len(self.columns)
        for i, row in enumerate(self.rows):
            if len(row) != width:
                raise ValueError(f"row {i} has {len(row)} cells but there are {width} columns")
        return self


# ---------------------------------------------------------------------------
# Argument models for the service-backed tools (those not 1:1 with an existing
# model). add_subscription reuses SubscriptionCreate and update_user_settings
# reuses ProfileUpdate directly.
# ---------------------------------------------------------------------------
class UpdateSubscriptionArgs(SubscriptionUpdate):
    """Partial subscription update plus the id to target. Inherits every optional
    field from SubscriptionUpdate so the model can send only what changes."""

    subscription_id: UUID


class CancelSubscriptionArgs(BaseModel):
    subscription_id: UUID
    cancellation_date: date | None = None


class DeleteSubscriptionArgs(BaseModel):
    subscription_id: UUID


class QuerySubscriptionsArgs(BaseModel):
    status: SubscriptionStatus | None = None
    category: Category | None = None
    sort_by: Literal["name", "price", "next_renewal_date", "created_at"] = "created_at"
    order: Literal["asc", "desc"] = "asc"
    limit: int = Field(default=50, ge=1, le=100)
    offset: int = Field(default=0, ge=0)


class _NoArgs(BaseModel):
    """Empty argument model for tools that take no parameters."""


# ---------------------------------------------------------------------------
# Handlers — thin adapters over existing services, each called with the caller's
# claims so RLS applies. Service dicts are normalized through the response models
# so tool output is always JSON-safe (Decimal->str, date->iso, UUID->str).
# ---------------------------------------------------------------------------
async def _add_subscription(claims: dict, args: SubscriptionCreate) -> dict:
    row = await sub_svc.create_subscription(claims, args)
    return SubscriptionResponse(**row).model_dump(mode="json")


async def _update_subscription(claims: dict, args: UpdateSubscriptionArgs) -> dict:
    changes = SubscriptionUpdate(**args.model_dump(exclude={"subscription_id"}, exclude_unset=True))
    row = await sub_svc.update_subscription(claims, str(args.subscription_id), changes)
    return SubscriptionResponse(**row).model_dump(mode="json")


async def _cancel_subscription(claims: dict, args: CancelSubscriptionArgs) -> dict:
    row = await sub_svc.cancel_subscription(
        claims, str(args.subscription_id), args.cancellation_date
    )
    return SubscriptionResponse(**row).model_dump(mode="json")


async def _delete_subscription(claims: dict, args: DeleteSubscriptionArgs) -> dict:
    await sub_svc.delete_subscription(claims, str(args.subscription_id))
    return {"deleted": True, "subscription_id": str(args.subscription_id)}


async def _query_subscriptions(claims: dict, args: QuerySubscriptionsArgs) -> dict:
    result = await sub_svc.list_subscriptions(
        claims,
        status=args.status,
        category=args.category,
        sort_by=args.sort_by,
        order=args.order,
        limit=args.limit,
        offset=args.offset,
    )
    return SubscriptionListResponse(**result).model_dump(mode="json")


async def _get_analytics(claims: dict, args: _NoArgs) -> dict:
    data = await analytics_svc.build_overview(claims)
    return AnalyticsResponse(**data).model_dump(mode="json")


async def _get_user_settings(claims: dict, args: _NoArgs) -> dict:
    row = await profile_svc.get_my_profile(claims)
    return ProfileResponse(**row).model_dump(mode="json")


async def _update_user_settings(claims: dict, args: ProfileUpdate) -> dict:
    row = await profile_svc.update_my_profile(claims, args)
    return ProfileResponse(**row).model_dump(mode="json")


async def _render_chart(claims: dict, args: RenderChartArgs) -> dict:
    # Presentation-only: echo the validated, structurally-safe payload.
    return args.model_dump(mode="json")


async def _render_table(claims: dict, args: RenderTableArgs) -> dict:
    return args.model_dump(mode="json")


# ---------------------------------------------------------------------------
# Registration — the Session-3 tool set. Descriptions are English (LLM-internal).
# ---------------------------------------------------------------------------
def _register_builtin_tools() -> None:
    register(
        ToolSpec(
            "add_subscription",
            "Add a new subscription for the user. Optionally include manage_url, a "
            "link to the provider's manage/cancel page.",
            SubscriptionCreate,
            _add_subscription,
        )
    )
    register(
        ToolSpec(
            "update_subscription",
            "Update fields of one of the user's existing subscriptions by id. Only "
            "the fields provided are changed.",
            UpdateSubscriptionArgs,
            _update_subscription,
        )
    )
    register(
        ToolSpec(
            "mark_subscription_cancelled",
            "Mark one of the user's subscriptions as cancelled (soft cancel, row "
            "retained). Confirm with the user before calling.",
            CancelSubscriptionArgs,
            _cancel_subscription,
        )
    )
    register(
        ToolSpec(
            "delete_subscription",
            "Permanently delete one of the user's subscriptions by id. Confirm with "
            "the user before calling.",
            DeleteSubscriptionArgs,
            _delete_subscription,
        )
    )
    register(
        ToolSpec(
            "query_subscriptions",
            "List the user's subscriptions with optional status/category filters, "
            "sorting, and pagination.",
            QuerySubscriptionsArgs,
            _query_subscriptions,
        )
    )
    register(
        ToolSpec(
            "get_analytics",
            "Get the user's real spending roll-up (monthly/annual burn, top "
            "expenses, upcoming renewals, spend by category), grouped per currency. "
            "This is the only source of numbers for charts and tables.",
            _NoArgs,
            _get_analytics,
        )
    )
    register(
        ToolSpec(
            "get_user_settings",
            "Get the user's profile settings (display name, preferred language).",
            _NoArgs,
            _get_user_settings,
        )
    )
    register(
        ToolSpec(
            "update_user_settings",
            "Update the user's profile settings (display name and/or preferred " "language).",
            ProfileUpdate,
            _update_user_settings,
        )
    )
    register(
        ToolSpec(
            "render_chart",
            "Package already-fetched analytics numbers into a chart for the user. "
            "Use only data returned by get_analytics in this conversation.",
            RenderChartArgs,
            _render_chart,
        )
    )
    register(
        ToolSpec(
            "render_table",
            "Package already-fetched data into a table for the user. Use only data "
            "returned by a tool in this conversation.",
            RenderTableArgs,
            _render_table,
        )
    )


_register_builtin_tools()
