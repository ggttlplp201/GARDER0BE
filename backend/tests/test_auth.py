import os
import time
import jwt
import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_SERVICE_KEY", "service-key")
os.environ.setdefault("SUPABASE_JWT_SECRET", "test-secret-at-least-32-chars-long!")
os.environ.setdefault("ANTHROPIC_API_KEY", "")

import main  # noqa: E402


SECRET = "test-secret-at-least-32-chars-long!"
SUPABASE_URL = "https://example.supabase.co"


def _make_token(sub="user-123", role="authenticated", exp_offset=3600, aud="authenticated"):
    now = int(time.time())
    return jwt.encode(
        {
            "sub": sub,
            "role": role,
            "aud": aud,
            "iss": f"{SUPABASE_URL}/auth/v1",
            "exp": now + exp_offset,
            "iat": now,
        },
        SECRET,
        algorithm="HS256",
    )


def test_valid_token_returns_sub():
    token = _make_token()
    assert main._jwt_sub(token) == "user-123"


def test_expired_token_raises():
    token = _make_token(exp_offset=-1)
    with pytest.raises(HTTPException) as exc_info:
        main._jwt_sub(token)
    assert exc_info.value.status_code == 401


def test_wrong_audience_raises():
    token = _make_token(aud="anon")
    with pytest.raises(HTTPException) as exc_info:
        main._jwt_sub(token)
    assert exc_info.value.status_code == 401


def test_wrong_role_raises():
    token = _make_token(role="anon")
    with pytest.raises(HTTPException) as exc_info:
        main._jwt_sub(token)
    assert exc_info.value.status_code == 401


def test_unsigned_token_raises():
    import base64
    import json
    header = base64.urlsafe_b64encode(b'{"alg":"none","typ":"JWT"}').rstrip(b"=").decode()
    payload = base64.urlsafe_b64encode(
        json.dumps({"sub": "evil", "role": "authenticated", "aud": "authenticated"}).encode()
    ).rstrip(b"=").decode()
    token = f"{header}.{payload}."
    with pytest.raises(HTTPException) as exc_info:
        main._jwt_sub(token)
    assert exc_info.value.status_code == 401


def test_crafted_sub_raises():
    # Token signed with a different secret
    token = jwt.encode(
        {"sub": "attacker", "role": "authenticated", "aud": "authenticated",
         "iss": f"{SUPABASE_URL}/auth/v1", "exp": int(time.time()) + 3600},
        "wrong-secret-totally-different-val",
        algorithm="HS256",
    )
    with pytest.raises(HTTPException) as exc_info:
        main._jwt_sub(token)
    assert exc_info.value.status_code == 401


client = TestClient(main.app)


def test_tag_requires_auth():
    resp = client.post("/tag")
    assert resp.status_code == 401


def test_refresh_one_requires_auth():
    resp = client.post("/wishlist/sources/some-source-id/refresh")
    assert resp.status_code == 401


def test_refresh_all_requires_auth():
    resp = client.post("/wishlist/refresh-all")
    assert resp.status_code == 401


def test_wrong_issuer_raises():
    token = jwt.encode(
        {"sub": "user-123", "role": "authenticated", "aud": "authenticated",
         "iss": "https://other.supabase.co/auth/v1", "exp": int(time.time()) + 3600},
        SECRET,
        algorithm="HS256",
    )
    with pytest.raises(HTTPException) as exc_info:
        main._jwt_sub(token)
    assert exc_info.value.status_code == 401


def test_missing_required_claim_raises():
    token = jwt.encode(
        # missing 'sub'
        {"role": "authenticated", "aud": "authenticated",
         "iss": f"{SUPABASE_URL}/auth/v1", "exp": int(time.time()) + 3600},
        SECRET,
        algorithm="HS256",
    )
    with pytest.raises(HTTPException) as exc_info:
        main._jwt_sub(token)
    assert exc_info.value.status_code == 401


def test_missing_jwt_secret_returns_503(monkeypatch):
    monkeypatch.setattr(main, "SUPABASE_JWT_SECRET", "")
    token = _make_token()
    with pytest.raises(HTTPException) as exc_info:
        main._jwt_sub(token)
    assert exc_info.value.status_code == 503


def test_refresh_one_ownership_returns_403():
    """Endpoint returns 403 when source belongs to a different user."""
    import unittest.mock as mock

    source_uuid = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
    valid_token = _make_token(sub="legitimate-user")
    other_owner_source = [{
        "id": source_uuid,
        "item_id": "11111111-2222-3333-4444-555555555555",
        "user_id": "different-user",
        "source_name": "Test",
        "source_url": "https://example.com",
        "currency": "USD",
        "is_active": True,
    }]

    mock_response = mock.MagicMock()
    mock_response.is_success = True
    mock_response.json.return_value = other_owner_source

    with mock.patch("httpx.AsyncClient") as mock_client_cls:
        mock_client = mock.AsyncMock()
        mock_client.__aenter__ = mock.AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = mock.AsyncMock(return_value=None)
        mock_client.get = mock.AsyncMock(return_value=mock_response)
        mock_client_cls.return_value = mock_client

        resp = client.post(
            f"/wishlist/sources/{source_uuid}/refresh",
            headers={"Authorization": f"Bearer {valid_token}"},
        )

    assert resp.status_code == 403
