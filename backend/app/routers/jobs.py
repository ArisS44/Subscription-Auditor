from fastapi import APIRouter, Header, HTTPException, status

from app.config import settings
from app.models.jobs import JobRunResult
from app.security.compare import constant_time_equals
from app.services.reminders import run_due_reminders

router = APIRouter(prefix="/jobs", tags=["jobs"])

# One generic failure for every rejected request. Missing header, malformed
# header, wrong token, and unset-configured-token all raise THIS identical object,
# so nothing about the response shape or body reveals which case occurred. This is
# authenticated by a shared token, NOT a user JWT — get_current_claims is
# deliberately not used, because the endpoint is publicly routable and has no user.
_UNAUTHORIZED = HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Unauthorized")


def _authenticate(token: str | None) -> None:
    """Authorize a run-due call by its shared token, failing closed and uniformly.

    Fail closed: if no token is configured, EVERY request is rejected — an empty
    configured token is never a valid credential, so a misconfigured deploy leaves
    the endpoint locked, not open. The header is compared in constant time so
    response timing cannot be used to recover the token byte by byte."""
    configured = settings.job_token
    if not configured:
        raise _UNAUTHORIZED
    if token is None or not constant_time_equals(token, configured):
        raise _UNAUTHORIZED


@router.post("/run-due", response_model=JobRunResult)
async def run_due(x_job_token: str | None = Header(default=None)) -> JobRunResult:
    _authenticate(x_job_token)
    return await run_due_reminders()
