# Auth Security Hardening Design

**Date:** 2026-05-12
**Goal:** Prevent account takeover for the GARDEROBE app
**Scope:** Harden existing Supabase Auth setup in-place — no auth provider migration

---

## Context

The app uses Supabase Auth (email/password), a React SPA frontend, and a FastAPI backend. RLS is already enabled on all tables, CORS is locked to the production domain, and JWT bearer tokens are used for API calls. The baseline is solid; this design closes the remaining account-takeover gaps.

Primary threat: account takeover via brute force, credential stuffing, or session token theft.

---

## Changes

### 1. JWT Signature Verification (Backend)

**File:** `backend/main.py` — `_jwt_sub()` function

**Problem:** The current implementation decodes the JWT without verifying the signature, meaning a crafted token with a fake `sub` claim would be accepted.

**Fix:** Verify the signature against `SUPABASE_JWT_SECRET` (already in `.env`) using `PyJWT`. If verification fails, raise an HTTP 401 before the claim is used.

```python
import jwt  # PyJWT

def _jwt_sub(token: str) -> str:
    payload = jwt.decode(
        token,
        os.environ["SUPABASE_JWT_SECRET"],
        algorithms=["HS256"],
        audience="authenticated",
    )
    return payload["sub"]
```

Add `PyJWT` to `requirements.txt`. No user-facing change.

---

### 2. Refresh Token Rotation

**Location:** Supabase dashboard → Auth → Configuration

**Change:** Enable "Refresh Token Rotation" toggle.

**Effect:** Each token refresh invalidates the previous refresh token. If a stolen refresh token is used, Supabase detects reuse and revokes the entire session. The legitimate user is logged out and must re-authenticate.

The frontend already uses `onAuthStateChange`, so it handles forced logout transparently.

---

### 3. Email Verification Gate

**File:** `src/App.jsx`

**Problem:** A user can sign up and access the full app without confirming their email, making throwaway accounts trivial.

**Fix:** After `onAuthStateChange` resolves a session, check `user.email_confirmed_at`. If null, render an `EmailVerificationScreen` component (small, informational) instead of the main app. The screen tells the user to check their inbox and offers a "Resend email" button via `supabase.auth.resend()`.

No database changes needed.

---

### 4. Optional TOTP MFA

**New files:**
- `src/components/TwoFactorSetup.jsx` — settings panel for enrolling/removing a TOTP factor
- `src/components/TwoFactorChallenge.jsx` — post-login screen for entering a TOTP code

**Enrollment flow (in settings):**
1. User clicks "Enable 2FA"
2. Call `supabase.auth.mfa.enroll({ factorType: 'totp' })`
3. Render the returned `totp.qr_code` URI as a QR code via `qrcode.react`
4. User scans with authenticator app, enters 6-digit code
5. Call `supabase.auth.mfa.challenge()` then `supabase.auth.mfa.verify()` to confirm
6. On success, show confirmation; factor is now active

**Login flow:**
1. After successful password login, call `supabase.auth.mfa.listFactors()`
2. If an active TOTP factor exists, redirect to `TwoFactorChallenge` screen
3. User enters code; call `supabase.auth.mfa.challenge()` + `supabase.auth.mfa.verify()`
4. On success, proceed to main app

**Disable flow (in settings):**
- "Remove 2FA" button calls `supabase.auth.mfa.unenroll({ factorId })`

**Dependencies:** `qrcode.react` (small, ~10kb)

Supabase stores all factor metadata — no database changes needed.

---

### 5. Rate Limiting on FastAPI

**File:** `backend/main.py`

**Dependency:** `slowapi` (add to `requirements.txt`)

**Setup:**
```python
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded

def get_user_id(request: Request) -> str:
    token = _bearer_token(request)
    if token:
        try:
            return _jwt_sub(token)
        except Exception:
            pass
    return get_remote_address(request)  # fallback for unauthenticated

limiter = Limiter(key_func=get_user_id)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
```

**Limits applied:**
- Price refresh / scraping endpoints: `@limiter.limit("10/hour")`
- Write endpoints (add item, delete item, AI tagging): `@limiter.limit("60/minute")`

Rate limiting is keyed on user ID (from JWT), not IP address, so VPNs and shared IPs don't affect legitimate users. Exceeding a limit returns HTTP 429.

---

### 6. Password Strength Enforcement

**Supabase dashboard:** Auth → Configuration → set minimum password length to 10 characters.

**File:** `src/components/AuthScreen.jsx`

During signup, add client-side validation: check that the password is at least 10 characters before enabling the submit button. Show a short inline message ("Must be at least 10 characters") if the user tries to submit short. No new dependencies needed.

---

## What is NOT in scope

- Migrating to Clerk or another auth provider
- SMS-based MFA (TOTP is sufficient and free)
- Mandatory MFA for all users
- Cloudflare WAF (useful but orthogonal to auth hardening; can be added independently)

---

## Testing

- JWT verification: test with a valid token, an expired token, and a crafted token with a fake sub — only the first should succeed
- Email gate: create an unverified account and confirm the gate renders; verify a real account and confirm it passes
- MFA enrollment: enroll a factor, verify the challenge flow works, unenroll and confirm the login flow skips the challenge
- Rate limiting: send >10 price refresh requests in an hour and confirm 429 is returned
- Password strength: attempt signup with a 9-character password and confirm it is blocked both client- and server-side
