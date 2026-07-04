def test_health_returns_200(test_client):
    r = test_client.get("/api/v1/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok"}


def test_ready_returns_200_when_db_reachable(test_client):
    r = test_client.get("/api/v1/ready")
    assert r.status_code == 200
    assert r.json()["database"] == "up"
