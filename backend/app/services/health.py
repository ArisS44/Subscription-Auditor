from app.db.database import ping_database


async def check_database_ready() -> bool:
    try:
        return await ping_database()
    except Exception:
        return False
