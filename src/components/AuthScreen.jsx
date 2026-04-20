import { useState, useRef, useEffect } from 'react';
import AsciiTitle from './AsciiTitle';
import ScatterCards from './ScatterCards';

export default function AuthScreen({ authMode, setAuthMode, onLogin, onSignUp }) {
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState('');
  const [info, setInfo]         = useState('');
  const veilRef  = useRef(null);
  const doorLRef = useRef(null);
  const doorRRef = useRef(null);
  const boxRef   = useRef(null);

  useEffect(() => {
    // Fade in from black
    const veil = veilRef.current;
    if (!veil) return;
    veil.style.transition = 'none';
    veil.style.opacity = '1';
    requestAnimationFrame(() => requestAnimationFrame(() => {
      veil.style.transition = 'opacity 2.6s ease';
      veil.style.opacity = '0';
    }));
  }, []);

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
      if (err) { setError(err.message); }
      else if (!data.session) { setInfo('Check your email to confirm your account, then sign in.'); }
      setLoading(false);
      return;
    }

    // Sign in — trigger door animation
    const { data, error: err } = await onLogin(email, password);
    if (err) { setError(err.message); setLoading(false); return; }
    if (!data.session) { setLoading(false); return; }

    // Animate doors open
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    doorLRef.current?.classList.add('open');
    doorRRef.current?.classList.add('open');
    await sleep(250);
    if (boxRef.current) { boxRef.current.style.transition = 'opacity 0.35s ease'; boxRef.current.style.opacity = '0'; }
    // The parent (App) will react to auth state change and swap screens
  }

  const isSignIn = authMode === 'signin';

  return (
    <div className="auth-screen open" style={{ perspective: '900px', perspectiveOrigin: 'center center' }}>
      <div ref={veilRef} id="auth-veil" />
      <ScatterCards />
      <AsciiTitle />
      <div ref={doorLRef} className="auth-door" id="door-left" />
      <div ref={doorRRef} className="auth-door" id="door-right" />

      <div ref={boxRef} className="auth-box">
        <div className="auth-mode-label">{isSignIn ? 'SIGN IN' : 'CREATE ACCOUNT'}</div>
        <div className="auth-field">
          <label>EMAIL</label>
          <input
            type="email" value={email} placeholder="your@email.com"
            onChange={e => setEmail(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSubmit()}
          />
        </div>
        <div className="auth-field">
          <label>PASSWORD</label>
          <input
            type="password" value={password} placeholder="••••••••"
            onChange={e => setPassword(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSubmit()}
          />
        </div>
        <button
          className="auth-submit-btn"
          onClick={handleSubmit}
          disabled={loading}
        >
          {loading ? 'LOADING...' : isSignIn ? 'SIGN IN' : 'CREATE ACCOUNT'}
        </button>
        {error && <div className="auth-error">{error}</div>}
        {info  && <div className="auth-info">{info}</div>}
        <div className="auth-demo-row">
          <button className="auth-demo-btn" onClick={fillDemo}>TRY DEMO</button>
        </div>
        <div className="auth-toggle">
          <span>{isSignIn ? "Don't have an account?" : 'Already have an account?'}</span>
          {' '}
          <button onClick={() => { setAuthMode(isSignIn ? 'signup' : 'signin'); setError(''); setInfo(''); }}>
            {isSignIn ? 'SIGN UP' : 'SIGN IN'}
          </button>
        </div>
      </div>
      <div className="page-copyright">© Leon Meng. All rights reserved.</div>
    </div>
  );
}
