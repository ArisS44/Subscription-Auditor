from app.db.profiles import get_profile_by_id, update_profile
from app.db.rls import rls_connection
from app.models.profile import ProfileUpdate


class ProfileNotFoundError(Exception):
    pass


async def get_my_profile(claims: dict) -> dict:
    user_id = claims["sub"]
    async with rls_connection(claims) as conn:
        row = await get_profile_by_id(conn, user_id)
    if row is None:
        raise ProfileNotFoundError()
    return dict(row)


async def update_my_profile(claims: dict, payload: ProfileUpdate) -> dict:
    user_id = claims["sub"]
    fields = payload.model_dump(exclude_unset=True)
    async with rls_connection(claims) as conn:
        row = await update_profile(conn, user_id, fields)
    if row is None:
        raise ProfileNotFoundError()
    return dict(row)
