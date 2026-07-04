from app.db.profiles import get_profile_by_id
from app.db.rls import rls_connection


class ProfileNotFoundError(Exception):
    pass


async def get_my_profile(claims: dict) -> dict:
    user_id = claims["sub"]
    async with rls_connection(claims) as conn:
        row = await get_profile_by_id(conn, user_id)
    if row is None:
        raise ProfileNotFoundError()
    return dict(row)
