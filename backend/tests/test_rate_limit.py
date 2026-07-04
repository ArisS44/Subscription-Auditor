from app.config import settings
from app.middleware.rate_limit import _storage


def test_rate_limiter_rejects_beyond_threshold(test_client, user_a):
    # Other tests hit /api/v1/me on the same shared in-memory counter
    # (keyed by path + client IP, and TestClient always uses the same
    # fake IP) — reset so this test sees a clean window.
    _storage.reset()

    _, token = user_a
    headers = {"Authorization": f"Bearer {token}"}
    threshold = settings.auth_rate_limit_per_minute

    statuses = [
        test_client.get("/api/v1/me", headers=headers).status_code for _ in range(threshold + 5)
    ]

    assert statuses[:threshold].count(200) == threshold
    assert 429 in statuses[threshold:]
