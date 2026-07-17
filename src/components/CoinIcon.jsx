export default function CoinIcon({ size = 12 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true"
      style={{ display: 'inline-block', verticalAlign: '-0.1em', flexShrink: 0 }}>
      <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="12" cy="12" r="7" fill="none" stroke="currentColor" strokeWidth="1" />
      <path d="M14.2 9.3a3.2 3.2 0 1 0 0 5.4" fill="none" stroke="currentColor"
        strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}
