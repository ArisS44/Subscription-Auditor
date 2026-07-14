from app.deps import verify_token
from app.services import tools
from app.services.tools import ToolSpec, _NoArgs, dispatch, registered_tool_names, tool_definitions

# --------------------------------------------------------------------------
# Registry shape (pure, no DB)
# --------------------------------------------------------------------------
_EXPECTED_TOOLS = {
    "add_subscription",
    "update_subscription",
    "mark_subscription_cancelled",
    "delete_subscription",
    "query_subscriptions",
    "get_analytics",
    "get_user_settings",
    "update_user_settings",
    "render_chart",
    "render_table",
}


def test_registry_has_exactly_the_session_tool_set():
    names = set(registered_tool_names())
    assert names == _EXPECTED_TOOLS
    # Out-of-scope tools must not be present (not even stubbed).
    assert "get_subscription_guide" not in names
    assert "get_recommendation" not in names


def test_tool_definitions_are_json_schema_objects():
    defs = {d.name: d for d in tool_definitions()}
    assert set(defs) == _EXPECTED_TOOLS
    for d in defs.values():
        assert d.parameters["type"] == "object"  # a JSON Schema the adapter can wrap


# --------------------------------------------------------------------------
# Gemini schema subset — the stricter rewrite for Gemini's function-calling
# validator (inline $ref/$defs, flatten nullable anyOf, drop unsupported keys).
# --------------------------------------------------------------------------
def _walk(node):
    """Yield every dict node in a schema tree."""
    if isinstance(node, dict):
        yield node
        for v in node.values():
            yield from _walk(v)
    elif isinstance(node, list):
        for v in node:
            yield from _walk(v)


def test_gemini_schema_has_no_refs_defs_or_null_type():
    for d in tool_definitions("gemini"):
        s = d.parameters
        for n in _walk(s):
            assert "$ref" not in n, f"{d.name}: $ref not inlined"
            assert "$defs" not in n, f"{d.name}: $defs not inlined"
            # Nullability must be `nullable: true`, never a `{"type": "null"}` branch.
            assert n.get("type") != "null", f"{d.name}: raw null type survived"


def test_gemini_schema_drops_metadata_keywords_but_keeps_field_named_title():
    defs = {d.name: d for d in tool_definitions("gemini")}
    # Top-level model `title`/`default` keywords are gone...
    add = defs["add_subscription"].parameters
    assert "title" not in add and "default" not in add
    # ...but a property legitimately *named* "title" (a chart/table title) stays.
    assert "title" in defs["render_chart"].parameters["properties"]


def test_gemini_schema_flattens_nullable_and_inlines_nested_model():
    defs = {d.name: d for d in tool_definitions("gemini")}
    # Optional field: anyOf[X, null] -> X + nullable, enum preserved.
    category = defs["update_subscription"].parameters["properties"]["category"]
    assert category["nullable"] is True
    assert category["type"] == "string"
    assert set(category["enum"]) == {
        "ai_tool",
        "streaming",
        "productivity",
        "cloud_storage",
        "other",
    }
    # render_chart's ChartPoint $ref is inlined into items.
    points = defs["render_chart"].parameters["properties"]["points"]
    assert points["items"]["type"] == "object"
    assert set(points["items"]["required"]) == {"label", "value"}


def test_generic_pass_still_default_for_non_gemini():
    # The generic (Groq-style) pass leaves anyOf/$defs untouched — proving the
    # Gemini rewrite is opt-in and doesn't change other providers' schemas.
    generic = {d.name: d for d in tool_definitions()}["update_subscription"].parameters
    assert "anyOf" in generic["properties"]["category"]


# --------------------------------------------------------------------------
# Validation / error contract (pure, no DB — malformed payloads never execute)
# --------------------------------------------------------------------------
async def test_unknown_tool_returns_clean_error():
    r = await dispatch("does_not_exist", {}, {})
    assert not r.ok
    assert "Unknown tool" in r.content["error"]


async def test_add_subscription_rejects_malformed_payload():
    r = await dispatch("add_subscription", {"name": "X", "start_date": "2026-01-01"}, {})
    assert not r.ok
    # LLM-consumable: names the tool and the offending fields.
    assert r.content["error"].startswith("Invalid arguments for add_subscription")
    assert "price" in r.content["error"]
    assert "billing_cycle" in r.content["error"]


async def test_update_subscription_requires_id():
    r = await dispatch("update_subscription", {"name": "Y"}, {})
    assert not r.ok
    assert "subscription_id" in r.content["error"]


async def test_update_user_settings_rejects_bad_language():
    r = await dispatch("update_user_settings", {"preferred_language": "fr"}, {})
    assert not r.ok
    assert "preferred_language" in r.content["error"]


async def test_bad_json_string_arguments_are_rejected():
    r = await dispatch("query_subscriptions", "{not json", {})
    assert not r.ok
    assert "valid JSON" in r.content["error"]


# --------------------------------------------------------------------------
# render_chart / render_table validators (pure, no DB)
# --------------------------------------------------------------------------
async def test_render_chart_accepts_valid_payload():
    r = await dispatch(
        "render_chart",
        {"chart_type": "bar", "currency": "USD", "points": [{"label": "Netflix", "value": 15.99}]},
        {},
    )
    assert r.ok
    assert r.content["chart_type"] == "bar"
    assert r.content["points"][0] == {"label": "Netflix", "value": 15.99}


async def test_render_chart_rejects_bad_chart_type():
    r = await dispatch(
        "render_chart", {"chart_type": "radar", "points": [{"label": "a", "value": 1}]}, {}
    )
    assert not r.ok


async def test_render_chart_rejects_non_finite_and_non_numeric_values():
    for bad in ["NaN", float("inf"), float("nan"), True, "12"]:
        r = await dispatch(
            "render_chart", {"chart_type": "bar", "points": [{"label": "a", "value": bad}]}, {}
        )
        assert not r.ok, f"value {bad!r} should be rejected"


async def test_render_chart_rejects_html_and_oversized_labels():
    r_html = await dispatch(
        "render_chart", {"chart_type": "bar", "points": [{"label": "<script>x", "value": 1}]}, {}
    )
    assert not r_html.ok and "HTML" in r_html.content["error"]

    r_long = await dispatch(
        "render_chart", {"chart_type": "bar", "points": [{"label": "a" * 200, "value": 1}]}, {}
    )
    assert not r_long.ok


async def test_render_table_enforces_row_width_and_sanitizes_cells():
    mismatch = await dispatch("render_table", {"columns": ["A", "B"], "rows": [["x"]]}, {})
    assert not mismatch.ok and "column" in mismatch.content["error"]

    html_cell = await dispatch("render_table", {"columns": ["A"], "rows": [["<img src=x>"]]}, {})
    assert not html_cell.ok

    ok = await dispatch(
        "render_table", {"columns": ["Name", "Cost"], "rows": [["Netflix", 15.99]]}, {}
    )
    assert ok.ok
    assert ok.content["rows"] == [["Netflix", 15.99]]  # text + numeric cells preserved


# --------------------------------------------------------------------------
# The registry is a registration mechanism, not an edit-the-core mechanism.
# --------------------------------------------------------------------------
async def test_adding_a_tool_is_registration_not_a_core_edit():
    async def _stub_handler(claims: dict, args: _NoArgs) -> dict:
        return {"stub": True}

    before = set(registered_tool_names())
    tools.register(ToolSpec("__stub_tool__", "A stub.", _NoArgs, _stub_handler))
    try:
        # The new tool dispatches with no change to dispatcher/loop code...
        r = await dispatch("__stub_tool__", {}, {})
        assert r.ok and r.content == {"stub": True}
        # ...and every previously-registered tool is untouched.
        assert before <= set(registered_tool_names())
        assert (
            await dispatch(
                "render_chart", {"chart_type": "bar", "points": [{"label": "a", "value": 1}]}, {}
            )
        ).ok
    finally:
        tools._REGISTRY.pop("__stub_tool__", None)


# --------------------------------------------------------------------------
# Real-DB: execution round-trip + RLS routing (a tool cannot cross users).
# --------------------------------------------------------------------------
def _sub_args(**overrides) -> dict:
    body = {
        "name": "Claude Pro",
        "price": "20.00",
        "currency": "USD",
        "billing_cycle": "monthly",
        "start_date": "2026-01-01",
    }
    body.update(overrides)
    return body


async def test_add_then_query_round_trip(db_pool, user_a):
    _, token = user_a
    claims = verify_token(token)

    added = await dispatch("add_subscription", _sub_args(name="RoundTrip"), claims)
    assert added.ok
    assert added.content["name"] == "RoundTrip"
    assert added.content["next_renewal_date"] is not None  # computed on create

    listed = await dispatch("query_subscriptions", {"status": "active"}, claims)
    assert listed.ok
    names = [item["name"] for item in listed.content["items"]]
    assert "RoundTrip" in names


async def test_get_analytics_returns_structured_rollup(db_pool, user_a):
    _, token = user_a
    claims = verify_token(token)
    r = await dispatch("get_analytics", {}, claims)
    assert r.ok
    # Empty portfolio → empty containers, never null / never a crash.
    assert r.content["monthly_burn_by_currency"] == {}
    assert r.content["top_expenses"] == []


async def test_tool_cannot_cross_user_boundary(db_pool, user_a, user_b):
    """A tool routed through rls_connection(claims) cannot touch another user's
    row: user B's delete/update of user A's subscription reads as not-found, and
    A's row is unchanged. RLS is the enforcement mechanism, not an app check."""
    _, token_a = user_a
    _, token_b = user_b
    claims_a = verify_token(token_a)
    claims_b = verify_token(token_b)

    created = await dispatch("add_subscription", _sub_args(name="A only"), claims_a)
    assert created.ok
    sub_id = created.content["id"]

    # B cannot delete or update A's subscription — invisible under RLS → not-found.
    b_delete = await dispatch("delete_subscription", {"subscription_id": sub_id}, claims_b)
    assert not b_delete.ok and "not found" in b_delete.content["error"]

    b_update = await dispatch(
        "update_subscription", {"subscription_id": sub_id, "name": "hacked"}, claims_b
    )
    assert not b_update.ok

    # A's subscription is intact.
    a_view = await dispatch("query_subscriptions", {}, claims_a)
    names = [item["name"] for item in a_view.content["items"]]
    assert "A only" in names and "hacked" not in names
