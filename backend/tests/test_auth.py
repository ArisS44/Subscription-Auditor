GENERIC_401 = "Invalid authentication credentials"


def test_valid_token_returns_own_profile(test_client, user_a):
    user_id, token = user_a
    r = test_client.get("/api/v1/me", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200
    body = r.json()
    assert body["id"] == user_id


def test_missing_token_returns_generic_401(test_client):
    r = test_client.get("/api/v1/me")
    assert r.status_code == 401
    assert r.json()["detail"] == GENERIC_401


def test_malformed_token_returns_generic_401(test_client):
    r = test_client.get("/api/v1/me", headers={"Authorization": "Bearer not-a-jwt-at-all"})
    assert r.status_code == 401
    assert r.json()["detail"] == GENERIC_401


def test_tampered_signature_returns_generic_401(test_client, user_a):
    """Flips a character in the middle of the signature segment of a
    real, validly-issued token. Exercises the same `jwt.decode` failure
    path as an expired token (both raise `jwt.PyJWTError` subclasses
    caught identically in `verify_token`) without requiring a wait for
    real expiry or a private key we don't hold to forge one.

    Deliberately not the *last* character: base64url has no padding, and
    a signature whose byte length isn't a multiple of 3 ends in a
    character where some encoded bits are unused padding — flipping only
    those bits can decode to the identical signature bytes, silently
    defeating the tamper. A middle character's bits are all significant.
    """
    _, token = user_a
    header, payload, signature = token.split(".")
    mid = len(signature) // 2
    tampered_char = "A" if signature[mid] != "A" else "B"
    tampered_signature = signature[:mid] + tampered_char + signature[mid + 1 :]
    tampered_token = f"{header}.{payload}.{tampered_signature}"

    r = test_client.get("/api/v1/me", headers={"Authorization": f"Bearer {tampered_token}"})
    assert r.status_code == 401
    assert r.json()["detail"] == GENERIC_401


def test_security_headers_present(test_client):
    r = test_client.get("/api/v1/health")
    assert "default-src 'none'" in r.headers["content-security-policy"]
    assert "max-age=" in r.headers["strict-transport-security"]
    assert r.headers["x-content-type-options"] == "nosniff"
    assert r.headers["x-frame-options"] == "DENY"
    assert r.headers["referrer-policy"] == "no-referrer"
