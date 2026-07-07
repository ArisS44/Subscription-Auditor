from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field


class ProfileResponse(BaseModel):
    id: UUID
    email: str
    display_name: str | None = None
    preferred_language: str


class ProfileUpdate(BaseModel):
    """Partial update for the caller's own profile. Both fields optional so a
    PATCH sends only what changes. `preferred_language` mirrors the DB CHECK on
    profiles.preferred_language (defense in depth)."""

    display_name: str | None = Field(default=None, max_length=100)
    preferred_language: Literal["auto", "en", "el"] | None = None
