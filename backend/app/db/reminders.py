import asyncpg

# SERVICE-ROLE data access, confined to the renewal-reminder job. Every function
# here runs on a plain pooled connection (never rls_connection), so it executes as
# the service role and bypasses RLS — which is required, because the job has no
# user and must read across all users. Following the narrow precedents in
# db/fx.py and db/usage.py, this power is quarantined here: nothing in this module
# is imported by a user-facing route, and the device-fetch/prune below are
# deliberately NOT the rls-scoped versions in db/push.py. The duplication is the
# point — reusing a user-scoped helper here, or exposing these to a user route,
# would defeat RLS for that path.

# Ceiling on devices fanned out to per user in one run. `run-due` already bounds
# the subscriptions it scans (settings.reminder_job_batch_size), but that bound is
# only as good as the work each scanned row can trigger: every device here becomes
# an encrypted request to a push service. Deliberately a separate constant from
# db/push.py's — see the duplication note above. Far above any real device count,
# so it is a resource guard, not a policy the user can feel.
_MAX_DEVICES_PER_USER = 100


async def get_due_reminders(conn: asyncpg.Connection, *, limit: int) -> list[asyncpg.Record]:
    """Active subscriptions whose renewal falls inside their effective lead window
    and have not already been reminded for this renewal.

    A subscription is due when, evaluated now (there is no pre-scheduled queue):
      - status = 'active' (cancelled/paused are suppressed here, at send time);
      - next_renewal_date is set and not already in the past;
      - next_renewal_date minus the effective lead time is on or before today,
        where the effective lead time is COALESCE(subscription override, profile
        default) — the per-subscription value wins, NULL falls back to the profile;
      - no notification_deliveries row already claims this exact renewal.

    The NOT EXISTS pre-filters rows already handled so the job does not attempt to
    re-claim them, but it is only an optimization — the ledger insert with its
    unique constraint is the actual idempotency guard. Ordered deterministically
    and LIMITed so a publicly-triggerable endpoint cannot be coerced into
    unbounded work and repeated runs make forward progress.

    Uses the partial index subscriptions_active_next_renewal_date_idx (on
    next_renewal_date WHERE status='active') created for exactly this scan.
    """
    return await conn.fetch(
        """
        SELECT s.id, s.user_id, s.name, s.price, s.currency, s.next_renewal_date,
               p.preferred_language
        FROM subscriptions s
        JOIN profiles p ON p.id = s.user_id
        WHERE s.status = 'active'
          AND s.next_renewal_date IS NOT NULL
          AND s.next_renewal_date >= CURRENT_DATE
          AND s.next_renewal_date
              - COALESCE(s.reminder_lead_days, p.renewal_lead_days) <= CURRENT_DATE
          AND NOT EXISTS (
              SELECT 1 FROM notification_deliveries d
              WHERE d.user_id = s.user_id
                AND d.subscription_id = s.id
                AND d.kind = 'renewal_reminder'
                AND d.due_date = s.next_renewal_date
          )
        ORDER BY s.next_renewal_date ASC, s.id ASC
        LIMIT $1
        """,
        limit,
    )


async def claim_delivery(
    conn: asyncpg.Connection, *, user_id: object, subscription_id: object, due_date: object
) -> bool:
    """Claim the reminder for one (user, subscription, renewal) by inserting the
    ledger row BEFORE any send is attempted. Returns True if this call created the
    row (caller should send), False if it already existed (a prior run, a retry, or
    a concurrent invocation already handled it — caller must skip).

    This is the whole idempotency mechanism: the insert either wins or hits the
    UNIQUE NULLS NOT DISTINCT constraint and does nothing. There is no read-then-
    write window to race, unlike an application-level 'already sent?' check."""
    row = await conn.fetchrow(
        """
        INSERT INTO notification_deliveries (user_id, subscription_id, kind, due_date)
        VALUES ($1, $2, 'renewal_reminder', $3)
        ON CONFLICT DO NOTHING
        RETURNING id
        """,
        user_id,
        subscription_id,
        due_date,
    )
    return row is not None


async def mark_delivered(conn: asyncpg.Connection, *, delivery_id: object) -> None:
    """Stamp delivered_at once the push provider has accepted at least one send for
    this claim. A NULL delivered_at therefore means 'claimed but never confirmed
    delivered' — the state a crash between claim and send leaves behind."""
    await conn.execute(
        "UPDATE notification_deliveries SET delivered_at = now() WHERE id = $1", delivery_id
    )


async def get_delivery_id(
    conn: asyncpg.Connection, *, user_id: object, subscription_id: object, due_date: object
) -> object | None:
    """The ledger row id for a claim, so a successful send can stamp delivered_at."""
    return await conn.fetchval(
        """
        SELECT id FROM notification_deliveries
        WHERE user_id = $1 AND subscription_id = $2
          AND kind = 'renewal_reminder' AND due_date = $3
        """,
        user_id,
        subscription_id,
        due_date,
    )


async def get_active_push_subscriptions(
    conn: asyncpg.Connection, *, user_id: object
) -> list[asyncpg.Record]:
    """One user's registered push devices (endpoint + keys), read as the service
    role. This is intentionally a separate function from db/push.py's rls-scoped
    list — the job has no JWT to scope by, so it filters on user_id explicitly.
    Keeping it here, not in push.py, is what stops this service-role read from
    being reachable through a user route.

    Bounded per user, because this is the actual job path: `run-due` is externally
    triggerable and already caps the subscriptions it scans, but that cap meant
    little while each of those could fan out to an unbounded number of devices.
    The ceiling is stated here rather than imported from db/push.py — the two
    modules are deliberately duplicated so the service-role reads stay unreachable
    from user code, and sharing state between them would start eroding that."""
    return await conn.fetch(
        "SELECT id, endpoint, p256dh_key, auth_key FROM push_subscriptions "
        "WHERE user_id = $1 ORDER BY created_at ASC, id ASC LIMIT $2",
        user_id,
        _MAX_DEVICES_PER_USER,
    )


async def delete_push_subscription(conn: asyncpg.Connection, *, subscription_id: object) -> None:
    """Prune a push subscription the provider reported as permanently gone, as the
    service role. Separate from db/push.py's rls-scoped delete for the same
    confinement reason as the read above."""
    await conn.execute("DELETE FROM push_subscriptions WHERE id = $1", subscription_id)
