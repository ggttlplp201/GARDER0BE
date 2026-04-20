import { useEffect, useRef } from 'react';
import { renderAsciiTitle } from '../lib/ascii';

export default function AsciiTitle() {
  const preRef = useRef(null);

  useEffect(() => {
    const el = preRef.current;
    if (!el) return;
    const vw = window.innerWidth;
    const fsize = (vw * 0.9) / (280 * 0.601);
    el.style.fontSize   = fsize + 'px';
    el.style.lineHeight = (fsize * 0.65) + 'px';
    el.textContent = renderAsciiTitle();

    const id = setInterval(() => {
      if (el) el.textContent = renderAsciiTitle();
    }, 50);
    return () => clearInterval(id);
  }, []);

  return (
    <pre
      ref={preRef}
      id="ascii-title"
      style={{
        position: 'absolute', top: '50%', left: '50%',
        transform: 'translate(-50%, -50%)',
        fontFamily: "'Courier New', Courier, monospace",
        whiteSpace: 'pre', letterSpacing: 0,
        color: 'rgba(255,255,255,0.82)',
        pointerEvents: 'none', zIndex: 0, userSelect: 'none',
        margin: 0,
      }}
    />
  );
}
