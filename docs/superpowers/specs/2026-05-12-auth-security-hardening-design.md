# Auth Security Hardening Design

**Date:** 2026-05-12
**Goal:** Prevent account takeover for the GARDEROBE app
**Scope:** Harden existing Supabase Auth setup in-place — no auth provider migration

---

## Context

The app uses Supabase Auth (email/password), a React SPA frontend, and a FastAPI backend. RLS is already enabled on all tables, CORS is locked to the production domain, and JWT bearer tokens are used for API calls. The baseline is solid; this design closes the remaining account-takeover gaps.

Primary threat: account takeover via brute force, credential stuffing, or session token theft.

---

## Priority Tiers

### Must Do

1. JWT signature verification (fixed + stricter)
2. Auth/ownership checks on unprotected backend endpoints
3. Supabase Auth rate limits + CAPTCHA/Turnstile
4. Password policy + leaked-password protection

### Should Do

5. MFA with AAL enforcement (RLS + backend)
6. Shorter access-token lifetime + session inactivity limits
7. Security notification emails on password/MFA changes

### Nice to Have

8. Email verification gate screen (UI only; Supabase dashboard is the source of truth)
9. Refresh token rotation
10. Client-side password strength indicator
11. FastAPI rate limiting (for scraping/AI cost control, not auth security)

---

## Changes

### 1. JWT Signature Verification (Backend) — Must Do

**File:** `backend/main.py` — `_jwt_sub()` function

**Problem:** The current implementation decodes the JWT without verifying the signature, meaning a crafted token with a fake `sub` claim would be accepted.

**Fix:** Verify the signature using `PyJWT` with full claim validation. Validate signature, `exp`, `aud`, `iss`, and that `role === authenticated`. Raise HTTP 401 on any failure.

```python
import jwt  # PyJWT

SUPABASE_JWT_SECRET = os.environ["SUPABASE_JWT_SECRET"]
SUPABASE_URL = os.environ["SUPABASE_URL"]

def _jwt_sub(token: str) -> str:
    payload = jwt.decode(
        token,
        SUPABASE_JWT_SECRET,
        algorithms=["HS256"],
        audience="authenticated",
        issuer=f"{SUPABASE_URL}/auth/v1",
        options={"require": ["sub", "exp", "aud", "iss", "role"]},
    )
    if payload.get("role") != "authenticated":
        raise ValueError("Invalid role claim")
    return payload["sub"]
```

Add `PyJWT` to `requirements.txt`. No user-facing change.

**Note on future-proofing:** Supabase now supports asymmetric JWT signing (RS256/JWKS). HS256 with `SUPABASE_JWT_SECRET` is correct for existing projects, but if Supabase migrates this project to asymmetric keys, verification will need to switch to JWKS endpoint verification.

---

### 2. Authenticate and Ownership-Check Unprotected Endpoints — Must Do

**File:** `backend/main.py`

**Problem:** `/tag`, `/wishlist/sources/{source_id}/refresh`, and `/wishlist/refresh-all` are not properly authenticated. CORS headers do not protect against `curl` or scripts — they only affect browser requests. The refresh endpoints also use the service role key, so they can perform work on behalf of any user if called without proper auth.

**Fix:** Add a `require_auth` dependency that extracts and verifies the bearer token for every endpoint. For the refresh endpoints, additionally verify that the resource being operated on belongs to the authenticated user before performing any work.

```python
async def require_auth(request: Request) -> str:
    token = _bearer_token(request)
    if not token:
        raise HTTPException(status_code=401, detail="Missing token")
    try:
        return _jwt_sub(token)
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid token")
```

Apply as a dependency to all endpoints:
```python
@app.post("/tag")
async def tag_item(body: TagRequest, user_id: str = Depends(require_auth)):
    ...

@app.post("/wishlist/sources/{source_id}/refresh")
async def refresh_source(source_id: str, user_id: str = Depends(require_auth)):
    # verify source_id belongs to user_id before proceeding
    ...
```

For ownership checks on refresh endpoints: query Supabase to confirm the resource's `user_id` matches the authenticated user before doing any work. Return 403 if not.

---

### 3. Supabase Auth Rate Limits + CAPTCHA — Must Do

**Location:** Supabase dashboard → Auth → Configuration + Rate Limits

**Problem:** Brute force and credential stuffing hit `supabase.auth.signInWithPassword()` directly — they never touch the FastAPI backend. FastAPI rate limiting does not protect against this at all.

**Changes:**

- **Rate limits:** Configure Supabase's built-in auth rate limits for sign-in, sign-up, and password reset. The dashboard exposes per-hour limits per IP.
- **CAPTCHA (Cloudflare Turnstile):** Enable CAPTCHA protection on sign-in, sign-up, and password reset in the Supabase dashboard. Turnstile is free, invisible by default, and requires passing a site token from the frontend. Add the Turnstile script to the app and pass the token to `supabase.auth.signInWithPassword({ captchaToken })`.
- **Leaked password protection:** Enable "Check passwords against HaveIBeenPwned" in Supabase Auth settings if available on the current plan. This rejects passwords found in known breach datasets at sign-up and password change.

---

### 4. Password Policy — Must Do

**Supabase dashboard:** Auth → Configuration → set minimum password length to 10 characters.

**File:** `src/components/AuthScreen.jsx` — add client-side length check before submit (UX only, Supabase dashboard setting is the enforcing layer).

---

### 5. MFA with AAL Enforcement — Should Do

**New files:**
- `src/components/TwoFactorSetup.jsx` — settings panel for enrolling/removing a TOTP factor
- `src/components/TwoFactorChallenge.jsx` — post-login screen for entering a TOTP code

**Enrollment flow (in settings):**
1. User clicks "Enable 2FA"
2. Call `supabase.auth.mfa.enroll({ factorType: 'totp' })`
3. Render the returned `totp.qr_code` URI as a QR code via `qrcode.react`
4. User scans with authenticator app, enters 6-digit code
5. Call `supabase.auth.mfa.challenge()` then `supabase.auth.mfa.verify()` to confirm

**Login flow:**
1. After password login, call `supabase.auth.mfa.getAuthenticatorAssuranceLevel()`
2. If `currentLevel === 'aal1'` and `nextLevel === 'aal2'`, redirect to `TwoFactorChallenge`
3. User enters code; call `supabase.auth.mfa.challenge()` + `supabase.auth.mfa.verify()`

**Enforcement — this is required, UI alone is not sufficient:**

Per Supabase docs, the MFA UI does not enforce anything on its own. For users who have enrolled a verified factor, backend and RLS must reject `aal1` tokens.

RLS policy (add to all sensitive tables):
```sql
CREATE POLICY "require_aal2_if_enrolled"
ON items
FOR ALL
USING (
  auth.uid() = user_id
  AND (
    auth.jwt()->>'aal' = 'aal2'
    OR NOT EXISTS (
      SELECT 1 FROM auth.mfa_factors
      WHERE user_id = auth.uid() AND status = 'verified'
    )
  )
);
```

Backend enforcement: after verifying the JWT, check the `aal` claim. If the user has a verified MFA factor and `aal !== 'aal2'`, return 403.

**Disable flow:** "Remove 2FA" button calls `supabase.auth.mfa.unenroll({ factorId })`.

**Dependencies:** `qrcode.react`

---

### 6. Session Lifetime Limits — Should Do

**Location:** Supabase dashboard → Auth → Configuration

- Set **JWT expiry** to 1 hour (default is often longer).
- Set **refresh token expiry** to 7 days (tighten from default if longer).
- Enable **refresh token rotation** (each refresh invalidates the previous token; reuse detection revokes the session).
- Consider enabling **session inactivity timeout** if available on the current plan.

These settings are dashboard-only — no code changes required.

---

### 7. Security Notification Emails — Should Do

**Location:** Supabase dashboard → Auth → Email Templates

Enable and customize email alerts for:
- Password changed
- MFA factor enrolled or removed
- (If available) new sign-in from unrecognised device

These are template configuration changes in the Supabase dashboard. No code changes required.

---

### 8. Email Verification Gate (UI) — Nice to Have

**File:** `src/App.jsx`

After `onAuthStateChange` resolves, check `user.email_confirmed_at`. If null, render an `EmailVerificationScreen` with a "Resend email" button (`supabase.auth.resend()`).

**Note:** The Supabase dashboard setting "Enable email confirmations" is the enforcing layer. This React gate is UX only and is bypassable on its own. Enable the dashboard setting first; add this screen as a user-friendly complement.

---

### 9–11. Refresh Token Rotation, Password Indicator, FastAPI Rate Limits — Nice to Have

- **Refresh token rotation:** Covered under Section 6 (session limits).
- **Client-side password indicator:** Small inline check in `AuthScreen.jsx` — see Section 4.
- **FastAPI rate limiting with `slowapi`:** Useful for scraping/AI cost control, not auth security. If implemented in production with multiple workers, use a Redis backend instead of in-memory — in-memory limits don't hold across processes. Note `slowapi` requires each limited endpoint to accept `request: Request` as a parameter, and decorator order matters (`@limiter.limit` must wrap `@app.route`).

---

## What is NOT in scope

- Migrating to Clerk or another auth provider
- SMS-based MFA (TOTP is sufficient and free)
- Mandatory MFA for all users

---

## Testing

- **JWT verification:** valid token passes; expired, unsigned, wrong-audience, and crafted-sub tokens all return 401
- **Endpoint auth:** calling `/tag` and refresh endpoints without a token returns 401; calling with another user's resource ID returns 403
- **CAPTCHA:** sign-in without a captcha token is rejected; valid token passes
- **Password policy:** signup with a 9-character password is blocked server-side; 10-character passes
- **MFA enrollment:** enroll factor, verify challenge flow works, unenroll and confirm login skips challenge
- **AAL enforcement:** with a verified factor and an `aal1` token, RLS rejects the query and backend returns 403; `aal2` token passes
- **Session limits:** confirm token expiry is respected; confirm refresh token reuse triggers session revocation
