import { useState, useRef, useEffect, useCallback } from 'react';
import { Turnstile } from '@marsidev/react-turnstile';
import AsciiTitle from './AsciiTitle';
import AsciiBackground from './AsciiBackground';
import { tzAbbrev } from '../lib/geo';

const PAPER = '#f5f2ea';
const INK   = '#0a0a0a';
const MONO  = "'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, monospace";

function LiveClock() {
  const [ts, setTs] = useState('');
  useEffect(() => {
    function tick() {
      const now = new Date();
      const d = now.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: '2-digit' }).replace(/\//g, '.');
      const t = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
      const zone = tzAbbrev(null, now);
      setTs(`${d} · ${t}${zone ? ` ${zone}` : ''}`);
    }
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);
  return <span>{ts}</span>;
}

export default function AuthScreen({ authMode, setAuthMode, onLogin, onSignUp }) {
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState('');
  const [info, setInfo]         = useState('');
  const [captchaToken, setCaptchaToken] = useState('');
  const [focusCount, setFocus]  = useState(0);
  const [emailFocus, setEF]     = useState(false);
  const [pwFocus, setPF]        = useState(false);
  const [near, setNear]         = useState(true);
  const veilRef  = useRef(null);
  const doorLRef = useRef(null);
  const doorRRef = useRef(null);
  const formRef  = useRef(null);

  const anyFocus = focusCount > 0;
  const formOn = near || anyFocus;

  useEffect(() => {
    const veil = veilRef.current;
    if (!veil) return;
    veil.style.transition = 'none';
    veil.style.opacity = '1';
    requestAnimationFrame(() => requestAnimationFrame(() => {
      veil.style.transition = 'opacity 2.6s ease';
      veil.style.opacity = '0';
    }));
  }, []);

  // Glass panel fades when the cursor moves away from it
  useEffect(() => {
    const onMove = (e) => {
      const f = formRef.current; if (!f) return;
      const r = f.getBoundingClientRect(), pad = 60;
      setNear(e.clientX > r.left - pad && e.clientX < r.right + pad && e.clientY > r.top - pad && e.clientY < r.bottom + pad);
    };
    window.addEventListener('mousemove', onMove);
    return () => window.removeEventListener('mousemove', onMove);
  }, []);

  const onFocus  = useCallback(() => setFocus(n => n + 1), []);
  const onBlur   = useCallback(() => setFocus(n => Math.max(0, n - 1)), []);

  function fillDemo() {
    if (authMode !== 'signin') setAuthMode('signin');
    setEmail('demo@garderobe.app');
    setPassword('garderobe123');
    setError('');
  }

  async function handleSubmit() {
    if (!email || !password) { setError('Email and password are required.'); return; }
    if (authMode === 'signup' && password.length < 10) {
      setError('Password must be at least 10 characters.');
      return;
    }
    if (!captchaToken) { setError('Please complete the security check.'); return; }
    setLoading(true); setError(''); setInfo('');

    if (authMode === 'signup') {
      const { data, error: err } = await onSignUp(email, password, captchaToken);
      if (err) setError(err.message);
      else if (!data.session) setInfo('Check your email to confirm your account, then sign in.');
      setCaptchaToken('');
      setLoading(false);
      return;
    }

    const { data, error: err } = await onLogin(email, password, captchaToken);
    if (err) { setError(err.message); setCaptchaToken(''); setLoading(false); return; }
    if (!data.session) { setCaptchaToken(''); setLoading(false); return; }

    const sleep = ms => new Promise(r => setTimeout(r, ms));
    doorLRef.current?.classList.add('open');
    doorRRef.current?.classList.add('open');
    await sleep(600);
  }

  const isSignIn = authMode === 'signin';

  const fieldStyle = (focused) => ({
    width: '100%',
    background: 'transparent',
    border: 'none',
    borderBottom: `1px solid ${focused ? PAPER : 'rgba(245,242,234,0.3)'}`,
    padding: '8px 0',
    color: PAPER,
    fontFamily: MONO,
    fontSize: 13,
    letterSpacing: '0.1em',
    outline: 'none',
    transition: 'border-color 0.2s',
    boxSizing: 'border-box',
    borderRadius: 0,
  });

  return (
    <div style={{ position: 'fixed', inset: 0, background: INK, color: PAPER, fontFamily: MONO, overflow: 'hidden' }}>
      {/* ASCII grass + sky field (WebGL) */}
      <AsciiBackground />

      {/* Fade-in veil */}
      <div ref={veilRef} style={{ position: 'absolute', inset: 0, background: INK, zIndex: 50, pointerEvents: 'none' }} />

      {/* Door panels (on successful sign-in) */}
      <div ref={doorLRef} className="auth-door" id="door-left" />
      <div ref={doorRRef} className="auth-door" id="door-right" />

      {/* ASCII title */}
      <AsciiTitle />

      {/* Top bar */}
      <div className="auth-top-bar" style={{ position: 'absolute', top: 28, left: 0, right: 0, display: 'flex', justifyContent: 'space-between', gap: 16, padding: '0 36px', fontSize: 10, letterSpacing: '0.15em', zIndex: 2, textShadow: '0 1px 4px rgba(10,10,10,0.5)' }}>
        <span>/ ɡärd ˌrōb /</span>
        <span className="auth-clock"><LiveClock /></span>
      </div>

      {/* Centered glass form — fades when cursor is away */}
      <div
        ref={formRef}
        style={{
          position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%, -50%)',
          width: 'min(380px, calc(100vw - 48px))', zIndex: 10, boxSizing: 'border-box',
          padding: '30px 28px 26px',
          background: 'rgba(10,10,10,0.66)',
          backdropFilter: formOn ? 'blur(8px)' : 'blur(1px)',
          WebkitBackdropFilter: formOn ? 'blur(8px)' : 'blur(1px)',
          border: '1px solid rgba(245,242,234,0.16)',
          opacity: formOn ? 1 : 0.28,
          transition: 'opacity 0.5s ease, backdrop-filter 0.5s ease',
        }}
      >
        <div style={{ fontSize: 9, letterSpacing: '0.2em', opacity: 0.6, marginBottom: 26, textAlign: 'center' }}>
          ── ENTER THE ARCHIVE ──
        </div>

        {/* Email */}
        <div style={{ marginBottom: 22 }}>
          <div style={{ fontSize: 9, letterSpacing: '0.18em', opacity: 0.6, marginBottom: 6 }}>EMAIL</div>
          <input
            type="email"
            value={email}
            placeholder="YOUR@EMAIL.COM"
            onChange={e => setEmail(e.target.value)}
            onFocus={() => { onFocus(); setEF(true); }}
            onBlur={() => { onBlur(); setEF(false); }}
            onKeyDown={e => e.key === 'Enter' && handleSubmit()}
            style={fieldStyle(emailFocus)}
          />
        </div>

        {/* Password */}
        <div style={{ marginBottom: 8 }}>
          <div style={{ fontSize: 9, letterSpacing: '0.18em', opacity: 0.6, marginBottom: 6 }}>PASSWORD</div>
          <input
            type="password"
            value={password}
            placeholder="••••••••"
            onChange={e => setPassword(e.target.value)}
            onFocus={() => { onFocus(); setPF(true); }}
            onBlur={() => { onBlur(); setPF(false); }}
            onKeyDown={e => e.key === 'Enter' && handleSubmit()}
            style={fieldStyle(pwFocus)}
          />
        </div>

        {error && (
          <div style={{ fontSize: 9, letterSpacing: '0.15em', color: '#ff6b6b', marginTop: 8, marginBottom: 4 }}>
            ERROR · {error}
          </div>
        )}
        {info && (
          <div style={{ fontSize: 9, letterSpacing: '0.15em', color: PAPER, opacity: 0.7, marginTop: 8, marginBottom: 4 }}>
            {info}
          </div>
        )}

        <Turnstile
          siteKey={import.meta.env.VITE_TURNSTILE_SITE_KEY}
          onSuccess={setCaptchaToken}
          onExpire={() => setCaptchaToken('')}
          onError={() => setCaptchaToken('')}
          options={{ theme: 'dark' }}
        />

        <button
          onClick={handleSubmit}
          disabled={loading}
          style={{ width: '100%', padding: '14px 0', background: 'transparent', color: PAPER, border: '1px solid rgba(245,242,234,0.4)', fontFamily: MONO, fontSize: 11, letterSpacing: '0.22em', cursor: 'pointer', marginTop: 16, opacity: loading ? 0.5 : 1 }}
        >{loading ? 'LOADING…' : isSignIn ? 'SIGN IN' : 'CREATE ACCOUNT'}</button>

        <button
          onClick={fillDemo}
          style={{ width: '100%', padding: '14px 0', background: PAPER, color: INK, border: 'none', fontFamily: MONO, fontSize: 11, letterSpacing: '0.22em', cursor: 'pointer', fontWeight: 500, marginTop: 10 }}
        >TRY DEMO →</button>

        <div style={{ marginTop: 24, fontSize: 9, letterSpacing: '0.18em', textAlign: 'center' }}>
          <span style={{ opacity: 0.6 }}>{isSignIn ? 'NEW HERE? ' : 'HAVE AN ACCOUNT? '}</span>
          <span
            onClick={() => { setAuthMode(isSignIn ? 'signup' : 'signin'); setError(''); setInfo(''); }}
            style={{ borderBottom: `1px solid ${PAPER}`, paddingBottom: 1, cursor: 'pointer' }}
          >{isSignIn ? 'CREATE ACCOUNT' : 'SIGN IN'}</span>
        </div>
      </div>
    </div>
  );
}
