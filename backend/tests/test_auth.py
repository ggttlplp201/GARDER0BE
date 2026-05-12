import importlib
import os
import time
import jwt
import pytest

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
    with pytest.raises(Exception):
        main._jwt_sub(token)


def test_wrong_audience_raises():
    token = _make_token(aud="anon")
    with pytest.raises(Exception):
        main._jwt_sub(token)


def test_wrong_role_raises():
    token = _make_token(role="anon")
    with pytest.raises(Exception):
        main._jwt_sub(token)


def test_unsigned_token_raises():
    import base64, json
    header = base64.urlsafe_b64encode(b'{"alg":"none","typ":"JWT"}').rstrip(b"=").decode()
    payload = base64.urlsafe_b64encode(
        json.dumps({"sub": "evil", "role": "authenticated", "aud": "authenticated"}).encode()
    ).rstrip(b"=").decode()
    token = f"{header}.{payload}."
    with pytest.raises(Exception):
        main._jwt_sub(token)


def test_crafted_sub_raises():
    # Token signed with a different secret
    token = jwt.encode(
        {"sub": "attacker", "role": "authenticated", "aud": "authenticated",
         "iss": f"{SUPABASE_URL}/auth/v1", "exp": int(time.time()) + 3600},
        "wrong-secret-totally-different-val",
        algorithm="HS256",
    )
    with pytest.raises(Exception):
        main._jwt_sub(token)
