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
    else { setError(''); setSent(true); }
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
