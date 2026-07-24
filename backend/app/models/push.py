from datetime import datetime
from typing import Annotated
from uuid import UUID

from pydantic import AnyHttpUrl, BaseModel, BeforeValidator, Field, TypeAdapter

# All input on this surface is attacker-controllable: the endpoint and keys come
# from a browser we do not trust, so every field is validated and length-capped
# at the API boundary. The endpoint is a URL we hand to the push service as a
# destination — it is NEVER fetched by our code, so there is no SSRF surface, and
# validation here exists only to reject junk and bound resource use.

# A push endpoint URL is generous but finite. Real endpoints are well under this.
_ENDPOINT_MAX = 2048
# p256dh is a base64url-encoded P-256 public point (~88 chars); auth is a
# base64url 16-byte secret (~24 chars). Caps are comfortably above real sizes.
_P256DH_MAX = 512
_AUTH_MAX = 256
_USER_AGENT_MAX = 512

# base64url alphabet, optionally '=' padded. The browser emits unpadded base64url;
# we accept optional padding defensively.
_B64URL = r"^[A-Za-z0-9_-]+=*$"

_http_url_adapter = TypeAdapter(AnyHttpUrl)


def _validate_endpoint(value: str) -> str:
    """Reject anything that is not a well-formed http(s) URL, and cap length.
    Length is checked first (cheap, bounds work before URL parsing). Returns the
    original string so it round-trips to the DB and to pywebpush unchanged rather
    than as a normalized Url object. The value is never fetched."""
    if len(value) > _ENDPOINT_MAX:
        raise ValueError(f"endpoint must be at most {_ENDPOINT_MAX} characters")
    _http_url_adapter.validate_python(value)
    return value


Endpoint = Annotated[str, BeforeValidator(_validate_endpoint)]


class PushKeys(BaseModel):
    """The device's payload-encryption keys, exactly as the browser's
    `PushSubscription.toJSON().keys` produces them. `p256dh` is the device public
    key the payload is encrypted to; `auth` is a shared secret mixed into the
    encryption scheme. Neither is a secret we hold — they are the recipient's, and
    they never appear in logs."""

    p256dh: str = Field(min_length=1, max_length=_P256DH_MAX, pattern=_B64URL)
    auth: str = Field(min_length=1, max_length=_AUTH_MAX, pattern=_B64URL)


class PushSubscriptionCreate(BaseModel):
    """A subscribe request, mirroring the native browser `PushSubscription` shape
    (`{endpoint, keys: {p256dh, auth}}`) plus an optional device label. `user_id`
    is intentionally absent — ownership comes from the caller's JWT, never the
    body."""

    endpoint: Endpoint
    keys: PushKeys
    # Free-text device label ("Chrome on laptop") so a user can tell their
    # registrations apart. Never parsed, never used for logic.
    user_agent: str | None = Field(default=None, max_length=_USER_AGENT_MAX)


class PushSubscriptionResponse(BaseModel):
    """A stored subscription as returned to the owner. The encryption keys are
    deliberately NOT echoed back — the client already has them, and not returning
    them keeps them off this response surface entirely."""

    id: UUID
    endpoint: str
    user_agent: str | None = None
    created_at: datetime


class NotificationPayload(BaseModel):
    """The message handed to a delivery channel. This is the unit the future
    composition layer produces and the channel consumes — it carries what to show,
    not how to send it. `url` is optional deep-link context for the service worker
    to open on click."""

    title: str = Field(min_length=1, max_length=200)
    body: str = Field(min_length=1, max_length=1000)
    url: str | None = Field(default=None, max_length=_ENDPOINT_MAX)


class PushTestResult(BaseModel):
    """Outcome of a fan-out to one user's registered devices. Counts only — never
    endpoints or message content."""

    total: int
    sent: int
    pruned: int
    failed: int
