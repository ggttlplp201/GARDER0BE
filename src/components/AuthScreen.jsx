import { useState, useRef, useEffect, useCallback } from 'react';
import AsciiTitle from './AsciiTitle';

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
      setTs(`${d} · ${t} PST`);
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
  const [focusCount, setFocus]  = useState(0);
  const [emailFocus, setEF]     = useState(false);
  const [pwFocus, setPF]        = useState(false);
  const veilRef  = useRef(null);
  const doorLRef = useRef(null);
  const doorRRef = useRef(null);

  const anyFocus = focusCount > 0;

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
    setLoading(true); setError(''); setInfo('');

    if (authMode === 'signup') {
      const { data, error: err } = await onSignUp(email, password);
      if (err) setError(err.message);
      else if (!data.session) setInfo('Check your email to confirm your account, then sign in.');
      setLoading(false);
      return;
    }

    const { data, error: err } = await onLogin(email, password);
    if (err) { setError(err.message); setLoading(false); return; }
    if (!data.session) { setLoading(false); return; }

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
  });

  // Last commit date — update when deploying
  const lastUpdate = '04.25.26';

  return (
    <div style={{ position: 'fixed', inset: 0, background: INK, color: PAPER, fontFamily: MONO, overflow: 'hidden' }}>
      {/* Fade-in veil */}
      <div ref={veilRef} style={{ position: 'absolute', inset: 0, background: INK, zIndex: 50, pointerEvents: 'none' }} />

      {/* Door panels (on successful sign-in) */}
      <div ref={doorLRef} className="auth-door" id="door-left" />
      <div ref={doorRRef} className="auth-door" id="door-right" />

      {/* ASCII title — opacity lifts on focus */}
      <div style={{ position: 'absolute', inset: 0, opacity: anyFocus ? 0.95 : 0.78, transition: 'opacity 0.2s' }}>
        <AsciiTitle />
      </div>

      {/* Top-left brand mark */}
      <div style={{ position: 'absolute', top: 28, left: 36, fontSize: 10, letterSpacing: '0.15em', opacity: 0.5 }}>
        / ɡärd ˌrōb / <span style={{ marginLeft: 14 }}>ISSUE 04 · VOL. XXVI</span>
      </div>

      {/* Top-right timestamp */}
      <div style={{ position: 'absolute', top: 28, right: 36, fontSize: 10, letterSpacing: '0.15em', opacity: 0.5 }}>
        <LiveClock />
      </div>

      {/* Centered form */}
      <div style={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%, -50%)', width: 380, zIndex: 10 }}>
        <div style={{ fontSize: 9, letterSpacing: '0.2em', opacity: 0.5, marginBottom: 26, textAlign: 'center' }}>
          ── ENTER THE ARCHIVE ──
        </div>

        {/* Email */}
        <div style={{ marginBottom: 22 }}>
          <div style={{ fontSize: 9, letterSpacing: '0.18em', opacity: 0.55, marginBottom: 6 }}>EMAIL</div>
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
          <div style={{ fontSize: 9, letterSpacing: '0.18em', opacity: 0.55, marginBottom: 6 }}>PASSWORD</div>
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

        {/* Error / info */}
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

        {/* TRY DEMO — primary */}
        <button
          onClick={fillDemo}
          style={{ width: '100%', padding: '14px 0', background: PAPER, color: INK, border: 'none', fontFamily: MONO, fontSize: 11, letterSpacing: '0.22em', cursor: 'pointer', fontWeight: 500, marginTop: 16 }}
        >TRY DEMO →</button>

        {/* SIGN IN / CREATE — secondary */}
        <button
          onClick={handleSubmit}
          disabled={loading}
          style={{ width: '100%', padding: '14px 0', background: 'transparent', color: PAPER, border: '1px solid rgba(245,242,234,0.4)', fontFamily: MONO, fontSize: 11, letterSpacing: '0.22em', cursor: 'pointer', marginTop: 10, opacity: loading ? 0.5 : 1 }}
        >{loading ? 'LOADING…' : isSignIn ? 'SIGN IN' : 'CREATE ACCOUNT'}</button>

        {/* Toggle sign in / sign up */}
        <div style={{ marginTop: 24, fontSize: 9, letterSpacing: '0.18em', opacity: 0.45, textAlign: 'center' }}>
          {isSignIn ? 'NEW HERE? ' : 'HAVE AN ACCOUNT? '}
          <span
            onClick={() => { setAuthMode(isSignIn ? 'signup' : 'signin'); setError(''); setInfo(''); }}
            style={{ borderBottom: `1px solid ${PAPER}`, opacity: 1, paddingBottom: 1, cursor: 'pointer' }}
          >{isSignIn ? 'CREATE ACCOUNT' : 'SIGN IN'}</span>
        </div>
      </div>

      {/* Footer */}
      <div style={{ position: 'absolute', bottom: 22, left: 0, right: 0, textAlign: 'center', fontSize: 9, letterSpacing: '0.2em', opacity: 0.4 }}>
        LAST UPDATE {lastUpdate} · IRVINE, CA
      </div>
    </div>
  );
}
