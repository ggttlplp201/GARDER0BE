# Auth Security Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent account takeover by closing JWT verification, authentication, and session-security gaps across the GARDEROBE backend and frontend.

**Architecture:** Backend auth is hardened first (JWT signature verification, require_auth dependency, endpoint protection) so the security layer can't be bypassed regardless of frontend state. Frontend changes add UX-layer defenses (CAPTCHA, password strength, MFA flows) on top. Supabase dashboard config is a prerequisite for several frontend features and should be done before those tasks.

**Tech Stack:** FastAPI + PyJWT (backend), React + Supabase JS v2 (frontend), Cloudflare Turnstile (CAPTCHA), qrcode.react + @marsidev/react-turnstile (new frontend deps)

---

## File Map

**Create:**
- `backend/tests/test_auth.py` — pytest tests for JWT verification and auth dependency
- `src/components/EmailVerificationScreen.jsx` — shown when email not yet confirmed
- `src/components/TwoFactorSetup.jsx` — TOTP enrollment/removal UI in settings
- `src/components/TwoFactorChallenge.jsx` — post-login TOTP code entry screen

**Modify:**
- `backend/requirements.txt` — add PyJWT, pytest, pytest-asyncio, httpx[test]
- `backend/main.py` — rewrite `_jwt_sub`, add `require_auth` dependency, apply to unprotected endpoints, add ownership checks
- `src/hooks/useAuth.js` — add MFA methods (enroll, challenge, verify, listFactors, unenroll), add `resendVerification`
- `src/components/AuthScreen.jsx` — add Turnstile widget, password min-length validation, pass captchaToken
- `src/App.jsx` — add email verification gate + MFA challenge gate between login and main app

**New migration:**
- `supabase_aal_rls_migration.sql` — restrictive RLS policies requiring aal2 for enrolled users

---

## Task 1: Supabase Dashboard Hardening (Config Only)

**Files:** None — all changes in Supabase dashboard

These settings are the server-side enforcement layer. Complete them before any other task.

- [ ] **Step 1: Set password minimum length**

  Dashboard → Authentication → Providers → Email → Password minimum length: **10**

- [ ] **Step 2: Enable email confirmations**

  Dashboard → Authentication → Providers → Email → Enable email confirmations: **on**

- [ ] **Step 3: Enable refresh token rotation**

  Dashboard → Authentication → Configuration → Refresh token rotation: **on**
  Set refresh token expiry to **604800** seconds (7 days) if not already set.

- [ ] **Step 4: Tighten JWT expiry**

  Dashboard → Authentication → Configuration → JWT expiry: **3600** seconds (1 hour)

- [ ] **Step 5: Enable auth rate limits**

  Dashboard → Authentication → Rate Limits → enable limits on:
  - Sign-ins per hour (recommend 20 per IP)
  - Sign-ups per hour (recommend 10 per IP)
  - Password reset per hour (recommend 5 per IP)

- [ ] **Step 6: Enable leaked password protection**

  Dashboard → Authentication → Configuration → Password protection → "Check passwords against HaveIBeenPwned": **on** (if available on current plan)

- [ ] **Step 7: Register Cloudflare Turnstile site**

  Go to dash.cloudflare.com → Turnstile → Add Site.
  - Name: GARDEROBE
  - Domain: the-garderobe.com (and localhost for testing)
  - Widget mode: **Managed** (invisible by default, challenges on suspicion)
  - Copy the **Site Key** and **Secret Key** for use in Tasks 5 and dashboard config.

- [ ] **Step 8: Enable CAPTCHA in Supabase**

  Dashboard → Authentication → Configuration → Enable CAPTCHA protection: **on**
  Provider: **Turnstile**, paste the Cloudflare Turnstile **Secret Key**.

- [ ] **Step 9: Configure security notification emails**

  Dashboard → Authentication → Email Templates → enable/customise templates for:
  - "Confirm your email address"
  - "Reset your password"
  (Check if "MFA enrolled" template is available; enable if so.)

- [ ] **Step 10: Commit a note**

  ```bash
  git commit --allow-empty -m "chore: supabase dashboard auth hardening applied"
  ```

---

## Task 2: Backend — JWT Verification + require_auth Dependency

**Files:**
- Modify: `backend/requirements.txt`
- Modify: `backend/main.py:370-386` (`_jwt_sub`, add `require_auth`)
- Create: `backend/tests/__init__.py`
- Create: `backend/tests/test_auth.py`

- [ ] **Step 1: Add dependencies to requirements.txt**

  Open `backend/requirements.txt`. Replace its contents with:

  ```
  fastapi==0.103.2
  uvicorn[standard]==0.23.2
  httpx==0.28.1
  anthropic==0.94.0
  python-multipart==0.0.12
  PyJWT==2.9.0
  pytest==8.3.3
  pytest-asyncio==0.24.0
  ```

- [ ] **Step 2: Write failing tests**

  Create `backend/tests/__init__.py` (empty file).

  Create `backend/tests/test_auth.py`:

  ```python
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
  ```

- [ ] **Step 3: Run tests — expect all to fail**

  ```bash
  cd backend && python -m pytest tests/test_auth.py -v
  ```

  Expected: most tests will fail because `_jwt_sub` currently returns `None` instead of raising.

- [ ] **Step 4: Add `import jwt` and `SUPABASE_JWT_SECRET` to main.py**

  At the top of `backend/main.py`, add to the existing imports block:

  ```python
  import jwt as pyjwt
  ```

  After the existing `SUPABASE_SERVICE_KEY` line, add:

  ```python
  SUPABASE_JWT_SECRET = os.environ.get("SUPABASE_JWT_SECRET", "")
  ```

- [ ] **Step 5: Replace `_jwt_sub` in main.py**

  Find and replace the existing `_jwt_sub` function (lines ~376-386):

  ```python
  def _jwt_sub(token: str) -> str:
      """Verify JWT signature and return the 'sub' claim (user UUID)."""
      if not SUPABASE_JWT_SECRET:
          raise HTTPException(status_code=503, detail="JWT secret not configured")
      try:
          payload = pyjwt.decode(
              token,
              SUPABASE_JWT_SECRET,
              algorithms=["HS256"],
              audience="authenticated",
              issuer=f"{SUPABASE_URL}/auth/v1",
              options={"require": ["sub", "exp", "aud", "iss", "role"]},
          )
      except pyjwt.ExpiredSignatureError:
          raise HTTPException(status_code=401, detail="Token expired")
      except pyjwt.InvalidTokenError as exc:
          raise HTTPException(status_code=401, detail=f"Invalid token: {exc}")
      if payload.get("role") != "authenticated":
          raise HTTPException(status_code=401, detail="Invalid role claim")
      return payload["sub"]
  ```

- [ ] **Step 6: Add `require_auth` dependency below `_jwt_sub`**

  Add immediately after the updated `_jwt_sub` function:

  ```python
  async def require_auth(authorization: Optional[str] = Header(None)) -> str:
      """FastAPI dependency — verifies bearer token and returns user_id."""
      token = _bearer_token(authorization)
      return _jwt_sub(token)
  ```

  Also add `Depends` to the existing FastAPI import line at the top:

  ```python
  from fastapi import Depends, FastAPI, File, Header, HTTPException, UploadFile
  ```

- [ ] **Step 7: Run tests — expect all to pass**

  ```bash
  cd backend && python -m pytest tests/test_auth.py -v
  ```

  Expected: all 6 tests pass.

- [ ] **Step 8: Commit**

  ```bash
  git add backend/requirements.txt backend/main.py backend/tests/
  git commit -m "feat: verify JWT signatures with PyJWT in backend"
  ```

---

## Task 3: Backend — Authenticate Unprotected Endpoints

**Files:**
- Modify: `backend/main.py` — `/tag`, `/wishlist/sources/{source_id}/refresh`, `/wishlist/refresh-all`
- Modify: `backend/tests/test_auth.py` — add endpoint auth tests

The `/tag`, `/wishlist/sources/{source_id}/refresh`, and `/wishlist/refresh-all` endpoints currently accept requests with no auth. The refresh endpoints additionally use the service role key, so they must verify ownership before operating.

- [ ] **Step 1: Write failing tests for endpoint auth**

  Append to `backend/tests/test_auth.py`:

  ```python
  from fastapi.testclient import TestClient

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
  ```

- [ ] **Step 2: Run tests — expect all to fail (currently 200/422)**

  ```bash
  cd backend && python -m pytest tests/test_auth.py::test_tag_requires_auth tests/test_auth.py::test_refresh_one_requires_auth tests/test_auth.py::test_refresh_all_requires_auth -v
  ```

- [ ] **Step 3: Add auth to `/tag`**

  Find the `/tag` endpoint signature (around line 272):

  ```python
  @app.post("/tag")
  async def tag_item(file: UploadFile = File(...)):
  ```

  Replace with:

  ```python
  @app.post("/tag")
  async def tag_item(file: UploadFile = File(...), user_id: str = Depends(require_auth)):
  ```

- [ ] **Step 4: Add auth + ownership check to `/wishlist/sources/{source_id}/refresh`**

  Find the `refresh_one_source` signature (around line 532):

  ```python
  @app.post("/wishlist/sources/{source_id}/refresh")
  async def refresh_one_source(source_id: str):
  ```

  Replace with:

  ```python
  @app.post("/wishlist/sources/{source_id}/refresh")
  async def refresh_one_source(source_id: str, user_id: str = Depends(require_auth)):
  ```

  Then inside the function, after the source is fetched and verified to exist, add an ownership check. Find this block:

  ```python
      source = resp.json()[0]
      if not source.get("is_active"):
          raise HTTPException(status_code=400, detail="Source is inactive")
  ```

  Replace with:

  ```python
      source = resp.json()[0]
      if source.get("user_id") != user_id:
          raise HTTPException(status_code=403, detail="Not authorised to refresh this source")
      if not source.get("is_active"):
          raise HTTPException(status_code=400, detail="Source is inactive")
  ```

  Also update the select query to include `user_id`. Find:

  ```python
              f"?id=eq.{source_id}&select=id,item_id,source_name,source_url,currency,is_active",
  ```

  Replace with:

  ```python
              f"?id=eq.{source_id}&select=id,item_id,user_id,source_name,source_url,currency,is_active",
  ```

- [ ] **Step 5: Add auth to `/wishlist/refresh-all`, restrict to caller's sources**

  Find the `refresh_all_prices` endpoint (around line 586):

  ```python
  @app.post("/wishlist/refresh-all")
  async def refresh_all_prices():
      return await _refresh_sources()
  ```

  Replace with:

  ```python
  @app.post("/wishlist/refresh-all")
  async def refresh_all_prices(user_id: str = Depends(require_auth)):
      return await _refresh_sources(user_id=user_id)
  ```

  Then update `_refresh_sources` to accept and filter by `user_id`. Find the function signature:

  ```python
  async def _refresh_sources(item_id: Optional[str] = None) -> dict:
  ```

  Replace with:

  ```python
  async def _refresh_sources(item_id: Optional[str] = None, user_id: Optional[str] = None) -> dict:
  ```

  Then find the query string line inside `_refresh_sources`:

  ```python
      qs = "is_active=eq.true&select=id,item_id,source_name,source_url,currency"
      if item_id:
          qs += f"&item_id=eq.{item_id}"
  ```

  Replace with:

  ```python
      qs = "is_active=eq.true&select=id,item_id,source_name,source_url,currency"
      if item_id:
          qs += f"&item_id=eq.{item_id}"
      if user_id:
          qs += f"&user_id=eq.{user_id}"
  ```

  Note: the scheduled background job calls `_refresh_sources()` with no arguments, so it still refreshes all users' sources as before. Only the HTTP endpoint now restricts to the caller.

- [ ] **Step 6: Clean up dead code in `add_price_source`**

  Now that `_jwt_sub` raises instead of returning None, the null-check in `add_price_source` is unreachable. Find (around line 493):

  ```python
      user_id = _jwt_sub(token)
      if not user_id:
          raise HTTPException(status_code=401, detail="Could not determine user from token")
  ```

  Replace with:

  ```python
      user_id = _jwt_sub(token)
  ```

- [ ] **Step 7: Run all tests — expect all to pass**

  ```bash
  cd backend && python -m pytest tests/test_auth.py -v
  ```

  Expected: all 9 tests pass.

- [ ] **Step 8: Commit**

  ```bash
  git add backend/main.py backend/tests/test_auth.py
  git commit -m "feat: require auth on /tag and wishlist refresh endpoints"
  ```

---

## Task 4: Frontend — Password Strength Validation

**Files:**
- Modify: `src/components/AuthScreen.jsx`

Adds a minimum 10-character check client-side. The Supabase dashboard setting (Task 1) is the enforcing layer; this is UX feedback only.

- [ ] **Step 1: Add password length check to `handleSubmit` in AuthScreen.jsx**

  Find the existing validation block inside `handleSubmit` (around line 62):

  ```javascript
    if (!email || !password) { setError('Email and password are required.'); return; }
  ```

  Replace with:

  ```javascript
    if (!email || !password) { setError('Email and password are required.'); return; }
    if (authMode === 'signup' && password.length < 10) {
      setError('Password must be at least 10 characters.');
      return;
    }
  ```

- [ ] **Step 2: Manual verification**

  Run `npm run dev`, go to the sign-up screen, enter a password shorter than 10 characters, and confirm the error message appears without a network request being made.

- [ ] **Step 3: Commit**

  ```bash
  git add src/components/AuthScreen.jsx
  git commit -m "feat: enforce minimum password length on signup"
  ```

---

## Task 5: Frontend — Cloudflare Turnstile CAPTCHA

**Files:**
- Modify: `src/components/AuthScreen.jsx`
- Modify: `src/hooks/useAuth.js`
- Modify: `index.html` (add Turnstile script)

Prerequisite: Task 1 Steps 7–8 must be complete (Turnstile site registered, Supabase CAPTCHA enabled).

- [ ] **Step 1: Install Turnstile React package**

  ```bash
  npm install @marsidev/react-turnstile
  ```

- [ ] **Step 2: Add VITE_TURNSTILE_SITE_KEY to .env.local**

  Open `.env.local` and add:

  ```
  VITE_TURNSTILE_SITE_KEY=your-turnstile-site-key-here
  ```

  Replace `your-turnstile-site-key-here` with the site key from Cloudflare dashboard.

- [ ] **Step 3: Add Turnstile to AuthScreen.jsx**

  At the top of `src/components/AuthScreen.jsx`, add to the imports:

  ```javascript
  import { Turnstile } from '@marsidev/react-turnstile';
  ```

  In the `AuthScreen` component state declarations (around line 28), add:

  ```javascript
  const [captchaToken, setCaptchaToken] = useState('');
  ```

  In `handleSubmit`, update the submit guard to require a captcha token:

  ```javascript
    if (!email || !password) { setError('Email and password are required.'); return; }
    if (authMode === 'signup' && password.length < 10) {
      setError('Password must be at least 10 characters.');
      return;
    }
    if (!captchaToken) { setError('Please complete the security check.'); return; }
  ```

  Pass the token when calling `onLogin` and `onSignUp`. Find:

  ```javascript
      const { data, error: err } = await onSignUp(email, password);
  ```

  Replace with:

  ```javascript
      const { data, error: err } = await onSignUp(email, password, captchaToken);
  ```

  And find:

  ```javascript
      const { data, error: err } = await onLogin(email, password);
  ```

  Replace with:

  ```javascript
      const { data, error: err } = await onLogin(email, password, captchaToken);
  ```

  Find where the form's submit button is rendered (look for `handleSubmit` in JSX) and add the Turnstile widget just above the submit button:

  ```jsx
  <Turnstile
    siteKey={import.meta.env.VITE_TURNSTILE_SITE_KEY}
    onSuccess={setCaptchaToken}
    onExpire={() => setCaptchaToken('')}
    onError={() => setCaptchaToken('')}
    options={{ theme: 'light' }}
  />
  ```

- [ ] **Step 4: Update useAuth.js to pass captchaToken**

  Replace the `signIn` function:

  ```javascript
  async function signIn(email, password, captchaToken) {
    const { data, error } = await sb.auth.signInWithPassword({
      email,
      password,
      options: { captchaToken },
    });
    return { data, error };
  }
  ```

  Replace the `signUp` function:

  ```javascript
  async function signUp(email, password, captchaToken) {
    const { data, error } = await sb.auth.signUp({
      email,
      password,
      options: { captchaToken },
    });
    return { data, error };
  }
  ```

- [ ] **Step 5: Manual verification**

  Run `npm run dev`. The Turnstile widget should appear on the login screen. Attempting to submit before it resolves should show "Please complete the security check." After it resolves (usually automatic), sign-in should proceed normally.

- [ ] **Step 6: Commit**

  ```bash
  git add src/components/AuthScreen.jsx src/hooks/useAuth.js package.json package-lock.json
  git commit -m "feat: add Cloudflare Turnstile CAPTCHA to sign-in and sign-up"
  ```

---

## Task 6: Frontend — Email Verification Gate

**Files:**
- Create: `src/components/EmailVerificationScreen.jsx`
- Modify: `src/hooks/useAuth.js`
- Modify: `src/App.jsx`

Prerequisite: Supabase email confirmations must be enabled (Task 1 Step 2). The dashboard setting prevents unverified accounts from getting a full session; this screen is a user-friendly complement.

- [ ] **Step 1: Create EmailVerificationScreen.jsx**

  Create `src/components/EmailVerificationScreen.jsx`:

  ```jsx
  import { useState } from 'react';

  const PAPER = '#f5f2ea';
  const INK   = '#0a0a0a';
  const MONO  = "'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, monospace";

  export default function EmailVerificationScreen({ email, onResend, onSignOut }) {
    const [sent, setSent] = useState(false);
    const [error, setError] = useState('');

    async function handleResend() {
      const { error: err } = await onResend(email);
      if (err) setError(err.message);
      else setSent(true);
    }

    return (
      <div style={{
        minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: PAPER, fontFamily: MONO, color: INK, padding: '2rem',
      }}>
        <div style={{ maxWidth: 420, width: '100%', textAlign: 'center' }}>
          <h1 style={{ fontSize: '1.1rem', letterSpacing: '0.15em', marginBottom: '1.5rem' }}>
            VERIFY YOUR EMAIL
          </h1>
          <p style={{ fontSize: '0.85rem', lineHeight: 1.6, marginBottom: '1.5rem' }}>
            A confirmation link was sent to <strong>{email}</strong>.<br />
            Click the link in that email to activate your account.
          </p>
          {sent && (
            <p style={{ fontSize: '0.8rem', color: '#666', marginBottom: '1rem' }}>
              Email resent.
            </p>
          )}
          {error && (
            <p style={{ fontSize: '0.8rem', color: '#c00', marginBottom: '1rem' }}>
              {error}
            </p>
          )}
          <button
            onClick={handleResend}
            disabled={sent}
            style={{
              background: 'none', border: `1px solid ${INK}`, color: INK,
              fontFamily: MONO, fontSize: '0.8rem', letterSpacing: '0.1em',
              padding: '0.6rem 1.4rem', cursor: sent ? 'default' : 'pointer',
              opacity: sent ? 0.5 : 1, marginBottom: '1rem',
            }}
          >
            RESEND EMAIL
          </button>
          <br />
          <button
            onClick={onSignOut}
            style={{
              background: 'none', border: 'none', color: '#888',
              fontFamily: MONO, fontSize: '0.75rem', cursor: 'pointer',
              textDecoration: 'underline',
            }}
          >
            Sign out
          </button>
        </div>
      </div>
    );
  }
  ```

- [ ] **Step 2: Add `resendVerification` to useAuth.js**

  Add the following function to `useAuth.js` inside the `useAuth` function body, before the return statement:

  ```javascript
  async function resendVerification(email) {
    const { error } = await sb.auth.resend({ type: 'signup', email });
    return { error };
  }
  ```

  Add `resendVerification` to the return object:

  ```javascript
  return { user, authMode, setAuthMode, signIn, signUp, signOut, resendVerification };
  ```

- [ ] **Step 3: Add the verification gate to App.jsx**

  At the top of `src/App.jsx`, add the import:

  ```javascript
  import EmailVerificationScreen from './components/EmailVerificationScreen';
  ```

  Then update the `useAuth` destructure line to include `resendVerification`:

  ```javascript
  const { user, authMode, setAuthMode, signIn, signUp, signOut, resendVerification } = useAuth();
  ```

  Find the block after `if (!user)` (around line 196–198):

  ```javascript
  if (!user) return (
    <AuthScreen authMode={authMode} setAuthMode={setAuthMode} onLogin={signIn} onSignUp={signUp} />
  );
  ```

  Add a new gate immediately after it:

  ```javascript
  if (user && !user.email_confirmed_at) return (
    <EmailVerificationScreen
      email={user.email}
      onResend={resendVerification}
      onSignOut={signOut}
    />
  );
  ```

- [ ] **Step 4: Manual verification**

  Run `npm run dev`. Create a new account. With email confirmations enabled in the dashboard, the app should show `EmailVerificationScreen` instead of the main app. Clicking "Resend Email" should trigger a second confirmation email.

- [ ] **Step 5: Commit**

  ```bash
  git add src/components/EmailVerificationScreen.jsx src/hooks/useAuth.js src/App.jsx
  git commit -m "feat: add email verification gate and resend flow"
  ```

---

## Task 7: Frontend — Optional TOTP MFA

**Files:**
- Create: `src/components/TwoFactorSetup.jsx`
- Create: `src/components/TwoFactorChallenge.jsx`
- Modify: `src/hooks/useAuth.js`
- Modify: `src/App.jsx`

- [ ] **Step 1: Install qrcode.react**

  ```bash
  npm install qrcode.react
  ```

- [ ] **Step 2: Add MFA methods to useAuth.js**

  Add the following functions inside `useAuth`, before the return statement:

  ```javascript
  async function mfaEnroll() {
    return await sb.auth.mfa.enroll({ factorType: 'totp', issuer: 'GARDEROBE' });
  }

  async function mfaVerify(factorId, code) {
    const { data: challenge, error: cErr } = await sb.auth.mfa.challenge({ factorId });
    if (cErr) return { error: cErr };
    return await sb.auth.mfa.verify({ factorId, challengeId: challenge.id, code });
  }

  async function mfaUnenroll(factorId) {
    return await sb.auth.mfa.unenroll({ factorId });
  }

  async function mfaListFactors() {
    return await sb.auth.mfa.listFactors();
  }

  async function mfaGetLevel() {
    return await sb.auth.mfa.getAuthenticatorAssuranceLevel();
  }
  ```

  Update the return statement:

  ```javascript
  return {
    user, authMode, setAuthMode,
    signIn, signUp, signOut, resendVerification,
    mfaEnroll, mfaVerify, mfaUnenroll, mfaListFactors, mfaGetLevel,
  };
  ```

- [ ] **Step 3: Create TwoFactorChallenge.jsx**

  Create `src/components/TwoFactorChallenge.jsx`:

  ```jsx
  import { useState } from 'react';

  const PAPER = '#f5f2ea';
  const INK   = '#0a0a0a';
  const MONO  = "'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, monospace";

  export default function TwoFactorChallenge({ factorId, onVerify, onSignOut }) {
    const [code, setCode]     = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError]   = useState('');

    async function handleSubmit() {
      if (code.length !== 6) { setError('Enter the 6-digit code from your authenticator app.'); return; }
      setLoading(true);
      setError('');
      const { error: err } = await onVerify(factorId, code);
      setLoading(false);
      if (err) setError(err.message);
    }

    return (
      <div style={{
        minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: PAPER, fontFamily: MONO, color: INK, padding: '2rem',
      }}>
        <div style={{ maxWidth: 380, width: '100%', textAlign: 'center' }}>
          <h1 style={{ fontSize: '1.1rem', letterSpacing: '0.15em', marginBottom: '1.5rem' }}>
            TWO-FACTOR AUTH
          </h1>
          <p style={{ fontSize: '0.85rem', marginBottom: '1.5rem' }}>
            Enter the code from your authenticator app.
          </p>
          <input
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={6}
            value={code}
            onChange={e => setCode(e.target.value.replace(/\D/g, ''))}
            placeholder="000000"
            style={{
              width: '100%', padding: '0.7rem 1rem', fontFamily: MONO,
              fontSize: '1.2rem', letterSpacing: '0.4em', textAlign: 'center',
              border: `1px solid ${INK}`, background: PAPER, color: INK,
              marginBottom: '1rem', boxSizing: 'border-box',
            }}
          />
          {error && <p style={{ fontSize: '0.8rem', color: '#c00', marginBottom: '0.75rem' }}>{error}</p>}
          <button
            onClick={handleSubmit}
            disabled={loading}
            style={{
              width: '100%', padding: '0.7rem', background: INK, color: PAPER,
              fontFamily: MONO, fontSize: '0.85rem', letterSpacing: '0.1em',
              border: 'none', cursor: loading ? 'default' : 'pointer', opacity: loading ? 0.6 : 1,
              marginBottom: '1rem',
            }}
          >
            {loading ? 'VERIFYING...' : 'VERIFY'}
          </button>
          <button
            onClick={onSignOut}
            style={{
              background: 'none', border: 'none', color: '#888',
              fontFamily: MONO, fontSize: '0.75rem', cursor: 'pointer',
              textDecoration: 'underline',
            }}
          >
            Sign out
          </button>
        </div>
      </div>
    );
  }
  ```

- [ ] **Step 4: Create TwoFactorSetup.jsx**

  Create `src/components/TwoFactorSetup.jsx`:

  ```jsx
  import { useState, useEffect } from 'react';
  import { QRCodeSVG } from 'qrcode.react';

  const INK  = '#0a0a0a';
  const MONO = "'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, monospace";

  export default function TwoFactorSetup({ mfaEnroll, mfaVerify, mfaUnenroll, mfaListFactors }) {
    const [factors, setFactors]     = useState([]);
    const [enrolling, setEnrolling] = useState(false);
    const [qrUri, setQrUri]         = useState('');
    const [factorId, setFactorId]   = useState('');
    const [code, setCode]           = useState('');
    const [status, setStatus]       = useState('');
    const [error, setError]         = useState('');

    useEffect(() => { loadFactors(); }, []);

    async function loadFactors() {
      const { data } = await mfaListFactors();
      setFactors(data?.totp ?? []);
    }

    async function startEnroll() {
      setError(''); setStatus('');
      const { data, error: err } = await mfaEnroll();
      if (err) { setError(err.message); return; }
      setQrUri(data.totp.qr_code);
      setFactorId(data.id);
      setEnrolling(true);
    }

    async function confirmEnroll() {
      if (code.length !== 6) { setError('Enter the 6-digit code.'); return; }
      const { error: err } = await mfaVerify(factorId, code);
      if (err) { setError(err.message); return; }
      setEnrolling(false); setQrUri(''); setCode(''); setFactorId('');
      setStatus('2FA enabled.');
      loadFactors();
    }

    async function handleUnenroll(id) {
      const { error: err } = await mfaUnenroll(id);
      if (err) { setError(err.message); return; }
      setStatus('2FA removed.');
      loadFactors();
    }

    const verifiedFactors = factors.filter(f => f.status === 'verified');

    return (
      <div style={{ fontFamily: MONO, fontSize: '0.85rem', color: INK }}>
        <h3 style={{ fontSize: '0.9rem', letterSpacing: '0.12em', marginBottom: '1rem' }}>
          TWO-FACTOR AUTHENTICATION
        </h3>

        {status && <p style={{ color: '#2a7a2a', marginBottom: '0.75rem' }}>{status}</p>}
        {error  && <p style={{ color: '#c00',    marginBottom: '0.75rem' }}>{error}</p>}

        {verifiedFactors.length === 0 && !enrolling && (
          <>
            <p style={{ marginBottom: '1rem', opacity: 0.7 }}>
              Not enabled. Add an authenticator app for extra security.
            </p>
            <button onClick={startEnroll} style={{
              background: 'none', border: `1px solid ${INK}`, color: INK,
              fontFamily: MONO, fontSize: '0.8rem', letterSpacing: '0.08em',
              padding: '0.5rem 1.2rem', cursor: 'pointer',
            }}>
              ENABLE 2FA
            </button>
          </>
        )}

        {enrolling && qrUri && (
          <div>
            <p style={{ marginBottom: '1rem' }}>
              Scan this QR code with your authenticator app, then enter the 6-digit code.
            </p>
            <QRCodeSVG value={qrUri} size={180} style={{ marginBottom: '1rem', display: 'block' }} />
            <input
              type="text" inputMode="numeric" pattern="[0-9]*" maxLength={6}
              value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ''))}
              placeholder="000000"
              style={{
                padding: '0.5rem 0.8rem', fontFamily: MONO, fontSize: '1rem',
                letterSpacing: '0.3em', border: `1px solid ${INK}`, background: 'transparent',
                color: INK, width: 140, marginBottom: '0.75rem',
              }}
            />
            <br />
            <button onClick={confirmEnroll} style={{
              background: INK, color: '#f5f2ea', fontFamily: MONO,
              fontSize: '0.8rem', letterSpacing: '0.08em',
              padding: '0.5rem 1.2rem', border: 'none', cursor: 'pointer', marginRight: '0.5rem',
            }}>
              CONFIRM
            </button>
            <button onClick={() => { setEnrolling(false); setQrUri(''); }} style={{
              background: 'none', border: `1px solid ${INK}`, color: INK,
              fontFamily: MONO, fontSize: '0.8rem', letterSpacing: '0.08em',
              padding: '0.5rem 1rem', cursor: 'pointer',
            }}>
              CANCEL
            </button>
          </div>
        )}

        {verifiedFactors.map(f => (
          <div key={f.id} style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <span style={{ opacity: 0.7 }}>Authenticator app enabled</span>
            <button onClick={() => handleUnenroll(f.id)} style={{
              background: 'none', border: 'none', color: '#c00',
              fontFamily: MONO, fontSize: '0.75rem', cursor: 'pointer',
              textDecoration: 'underline',
            }}>
              Remove
            </button>
          </div>
        ))}
      </div>
    );
  }
  ```

- [ ] **Step 5: Add MFA challenge gate to App.jsx**

  Add to the imports at the top of `src/App.jsx`:

  ```javascript
  import TwoFactorChallenge from './components/TwoFactorChallenge';
  ```

  Update the `useAuth` destructure to include MFA methods:

  ```javascript
  const {
    user, authMode, setAuthMode,
    signIn, signUp, signOut, resendVerification,
    mfaEnroll, mfaVerify, mfaUnenroll, mfaListFactors, mfaGetLevel,
  } = useAuth();
  ```

  Add MFA level state near the top of the component (after the `useAuth` line):

  ```javascript
  const [mfaPending, setMfaPending] = useState(null); // { factorId } | null
  ```

  Add a `useEffect` to check AAL after the user loads — place it alongside the existing user-effect hooks:

  ```javascript
  useEffect(() => {
    if (!user) { setMfaPending(null); return; }
    mfaGetLevel().then(({ data }) => {
      if (data?.nextLevel === 'aal2' && data?.currentLevel === 'aal1') {
        mfaListFactors().then(({ data: fd }) => {
          const verified = fd?.totp?.find(f => f.status === 'verified');
          if (verified) setMfaPending({ factorId: verified.id });
        });
      }
    });
  }, [user?.id]);
  ```

  Add the MFA gate immediately after the email verification gate added in Task 6:

  ```javascript
  if (user && mfaPending) return (
    <TwoFactorChallenge
      factorId={mfaPending.factorId}
      onVerify={async (factorId, code) => {
        const result = await mfaVerify(factorId, code);
        if (!result.error) setMfaPending(null);
        return result;
      }}
      onSignOut={signOut}
    />
  );
  ```

- [ ] **Step 6: Wire TwoFactorSetup into the profile/settings area**

  Find `src/components/ProfilePanel.jsx` — this is where user settings live. Add `TwoFactorSetup` somewhere in the settings section. Locate the return JSX and add:

  ```jsx
  import TwoFactorSetup from './TwoFactorSetup';

  // Inside the rendered settings area, add:
  <TwoFactorSetup
    mfaEnroll={mfaEnroll}
    mfaVerify={mfaVerify}
    mfaUnenroll={mfaUnenroll}
    mfaListFactors={mfaListFactors}
  />
  ```

  Pass `mfaEnroll`, `mfaVerify`, `mfaUnenroll`, `mfaListFactors` down from `App.jsx` to `ProfilePanel` as props (add them to where `ProfilePanel` is rendered in `App.jsx`).

- [ ] **Step 7: Manual verification**

  1. Sign in normally — confirm no MFA prompt appears (no factor enrolled yet).
  2. Go to profile settings → enable 2FA → scan QR code with an authenticator app → confirm 6-digit code.
  3. Sign out, sign back in — confirm the TOTP challenge screen appears.
  4. Enter the correct code → confirm access to main app.
  5. Go to settings → remove 2FA → sign out, sign back in — confirm no challenge appears.

- [ ] **Step 8: Commit**

  ```bash
  git add src/components/TwoFactorSetup.jsx src/components/TwoFactorChallenge.jsx src/hooks/useAuth.js src/App.jsx src/components/ProfilePanel.jsx package.json package-lock.json
  git commit -m "feat: optional TOTP MFA with enrollment, challenge, and removal"
  ```

---

## Task 8: Database — AAL Enforcement in RLS

**Files:**
- Create: `supabase_aal_rls_migration.sql`

For users who have enrolled and verified a TOTP factor, RLS should reject `aal1` tokens. This is the enforcement layer — the MFA UI in Task 7 is UX only without this.

- [ ] **Step 1: Create the migration file**

  Create `supabase_aal_rls_migration.sql`:

  ```sql
  -- AAL enforcement: users with a verified MFA factor must present aal2 tokens.
  -- Users without a verified factor are unaffected (they can't have aal2 anyway).

  -- Helper: returns true if the current user has a verified TOTP factor
  CREATE OR REPLACE FUNCTION auth.user_has_mfa()
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  AS $$
    SELECT EXISTS (
      SELECT 1 FROM auth.mfa_factors
      WHERE user_id = auth.uid()
        AND status = 'verified'
        AND factor_type = 'totp'
    );
  $$;

  -- Drop existing permissive policies on items and replace with AAL-aware ones.
  -- Repeat this pattern for each sensitive table.

  -- items table
  DROP POLICY IF EXISTS "Users can view own items" ON items;
  DROP POLICY IF EXISTS "Users can insert own items" ON items;
  DROP POLICY IF EXISTS "Users can update own items" ON items;
  DROP POLICY IF EXISTS "Users can delete own items" ON items;

  CREATE POLICY "items_select" ON items
    FOR SELECT USING (
      auth.uid() = user_id
      AND (
        (auth.jwt()->>'aal') = 'aal2'
        OR NOT auth.user_has_mfa()
      )
    );

  CREATE POLICY "items_insert" ON items
    FOR INSERT WITH CHECK (
      auth.uid() = user_id
      AND (
        (auth.jwt()->>'aal') = 'aal2'
        OR NOT auth.user_has_mfa()
      )
    );

  CREATE POLICY "items_update" ON items
    FOR UPDATE USING (
      auth.uid() = user_id
      AND (
        (auth.jwt()->>'aal') = 'aal2'
        OR NOT auth.user_has_mfa()
      )
    );

  CREATE POLICY "items_delete" ON items
    FOR DELETE USING (
      auth.uid() = user_id
      AND (
        (auth.jwt()->>'aal') = 'aal2'
        OR NOT auth.user_has_mfa()
      )
    );

  -- wishlist_price_sources table
  DROP POLICY IF EXISTS "Users can view own sources" ON wishlist_price_sources;
  DROP POLICY IF EXISTS "Users can insert own sources" ON wishlist_price_sources;
  DROP POLICY IF EXISTS "Users can update own sources" ON wishlist_price_sources;
  DROP POLICY IF EXISTS "Users can delete own sources" ON wishlist_price_sources;

  CREATE POLICY "wps_select" ON wishlist_price_sources
    FOR SELECT USING (
      auth.uid() = user_id
      AND (
        (auth.jwt()->>'aal') = 'aal2'
        OR NOT auth.user_has_mfa()
      )
    );

  CREATE POLICY "wps_insert" ON wishlist_price_sources
    FOR INSERT WITH CHECK (
      auth.uid() = user_id
      AND (
        (auth.jwt()->>'aal') = 'aal2'
        OR NOT auth.user_has_mfa()
      )
    );

  CREATE POLICY "wps_update" ON wishlist_price_sources
    FOR UPDATE USING (
      auth.uid() = user_id
      AND (
        (auth.jwt()->>'aal') = 'aal2'
        OR NOT auth.user_has_mfa()
      )
    );

  CREATE POLICY "wps_delete" ON wishlist_price_sources
    FOR DELETE USING (
      auth.uid() = user_id
      AND (
        (auth.jwt()->>'aal') = 'aal2'
        OR NOT auth.user_has_mfa()
      )
    );
  ```

  > **Note on existing policy names:** The DROP statements use common naming conventions. Check your actual policy names in Supabase dashboard → Table Editor → Policies and update the DROP statements to match if they differ.

- [ ] **Step 2: Run migration in Supabase**

  In Supabase dashboard → SQL Editor, paste and run the contents of `supabase_aal_rls_migration.sql`.

  Or via Supabase CLI if configured:

  ```bash
  supabase db push
  ```

- [ ] **Step 3: Verify in Supabase dashboard**

  Dashboard → Table Editor → items → Policies. Confirm the four new `items_*` policies exist and the old ones are gone. Repeat for `wishlist_price_sources`.

- [ ] **Step 4: Manual end-to-end verification**

  1. Enable MFA on a test account (Task 7).
  2. Sign in with password only (skip MFA challenge by signing in from a fresh tab before the Task 7 gate is complete — or use the Supabase dashboard to test directly).
  3. Attempt to query the `items` table with an `aal1` token — confirm it returns 0 rows (RLS blocks it).
  4. Complete MFA challenge → confirm items are accessible with an `aal2` token.

- [ ] **Step 5: Commit**

  ```bash
  git add supabase_aal_rls_migration.sql
  git commit -m "feat: AAL2 enforcement in RLS for users with verified MFA factors"
  ```
