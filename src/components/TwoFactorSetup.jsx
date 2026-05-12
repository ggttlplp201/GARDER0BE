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
  const [starting, setStarting]   = useState(false);

  useEffect(() => { loadFactors(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function loadFactors() {
    const { data } = await mfaListFactors();
    setFactors(data?.totp ?? []);
  }

  async function startEnroll() {
    setError(''); setStatus('');
    setStarting(true);
    const { data, error: err } = await mfaEnroll();
    setStarting(false);
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
          <button onClick={startEnroll} disabled={starting} style={{
            background: 'none', border: `1px solid ${INK}`, color: INK,
            fontFamily: MONO, fontSize: '0.8rem', letterSpacing: '0.08em',
            padding: '0.5rem 1.2rem', cursor: starting ? 'default' : 'pointer',
            opacity: starting ? 0.5 : 1,
          }}>
            {starting ? 'ENABLING...' : 'ENABLE 2FA'}
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
          <button onClick={() => {
            mfaUnenroll(factorId).catch(() => {});
            setEnrolling(false);
            setQrUri('');
            setFactorId('');
          }} style={{
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
