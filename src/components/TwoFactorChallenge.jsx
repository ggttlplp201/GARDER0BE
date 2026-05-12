import { useState } from 'react';

const PAPER = '#f5f2ea';
const INK   = '#0a0a0a';
const MONO  = "'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, monospace";

export default function TwoFactorChallenge({ factorId, onVerify, onSignOut }) {
  const [code, setCode]       = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');

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
