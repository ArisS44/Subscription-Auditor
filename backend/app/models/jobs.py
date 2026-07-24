from pydantic import BaseModel


class JobRunResult(BaseModel):
    """Counts-only summary of a run-due invocation. Deliberately carries no
    per-subscription detail, endpoints, or message content — the no-content rule
    applies with full force to work the user did not initiate and cannot see."""

    due: int  # subscriptions found due this run (before idempotency claim)
    sent: int  # subscriptions for which at least one device was delivered to
    skipped_already_sent: int  # due, but a prior run had already claimed them
    pruned: int  # dead push endpoints removed on permanent rejection
    failed: int  # subscriptions where every device send failed transiently
