from uuid import UUID

from pydantic import BaseModel


class ProfileResponse(BaseModel):
    id: UUID
    email: str
    display_name: str | None = None
    preferred_language: str
