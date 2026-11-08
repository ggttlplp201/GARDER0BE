import { useEffect, useRef } from 'react';

// Rotating 3D ASCII "GARDEROBE" — solid fill, constant shading, 30fps, time-based angle.
function renderTitle(A) {
  const P = {
    G:[[0,1,1,1,0],[1,0,0,0,1],[1,0,0,0,0],[1,0,1,1,1],[1,0,0,0,1],[1,0,0,0,1],[0,1,1,1,0]],
    A:[[0,1,1,1,0],[1,0,0,0,1],[1,0,0,0,1],[1,1,1,1,1],[1,0,0,0,1],[1,0,0,0,1],[1,0,0,0,1]],
    R:[[1,1,1,1,0],[1,0,0,0,1],[1,0,0,0,1],[1,1,1,1,0],[1,0,1,0,0],[1,0,0,1,0],[1,0,0,0,1]],
    D:[[1,1,1,1,0],[1,0,0,0,1],[1,0,0,0,1],[1,0,0,0,1],[1,0,0,0,1],[1,0,0,0,1],[1,1,1,1,0]],
    E:[[1,1,1,1,1],[1,0,0,0,0],[1,0,0,0,0],[1,1,1,1,0],[1,0,0,0,0],[1,0,0,0,0],[1,1,1,1,1]],
    O:[[0,1,1,1,0],[1,0,0,0,1],[1,0,0,0,1],[1,0,0,0,1],[1,0,0,0,1],[1,0,0,0,1],[0,1,1,1,0]],
    B:[[1,1,1,1,0],[1,0,0,0,1],[1,0,0,0,1],[1,1,1,1,0],[1,0,0,0,1],[1,0,0,0,1],[1,1,1,1,0]],
  };
  const AC = '.,-~:;=!*#$@', W = 420, H = 75;
  const z = new Float32Array(W * H), cb = new Uint8Array(W * H).fill(255);
  const cosA = Math.cos(A), sinA = Math.sin(A), text = 'GARDEROBE';
  for (let i = 0; i < text.length; i++) {
    const pat = P[text[i]], ox = (i - text.length / 2) * 8 + 2;
    for (let py = 0; py < 7; py += 0.16) for (let px = 0; px < 5; px += 0.16) {
      if (!pat[py | 0][px | 0]) continue;
      for (let pz = -2; pz <= 2; pz += 0.3) {
        const rx = (px + ox) * cosA - pz * sinA, rz = (px + ox) * sinA + pz * cosA + 100;
        if (rz <= 0) continue;
        const sc = 480 / rz, x2 = Math.floor(W / 2 + rx * sc), y2 = Math.floor(H / 2 + (py - 3.5) * sc);
        if (x2 >= 0 && x2 < W && y2 >= 0 && y2 < H) {
          const idx = x2 + y2 * W;
          if (rz > z[idx]) { z[idx] = rz; cb[idx] = AC.length - 1; }
        }
      }
    }
  }
  let out = '';
  for (let r = 0; r < H; r++) { for (let c = 0; c < W; c++) { const v = cb[c + r * W]; out += v < 255 ? AC[v] : ' '; } out += '\n'; }
  return out;
}


export default function AsciiTitle() {
  const preRef = useRef(null);

  useEffect(() => {
    const el = preRef.current;
    if (!el) return;
    const size = () => {
      const fs = (window.innerWidth * 0.94) / (420 * 0.601);
      el.style.fontSize = fs + 'px';
      el.style.lineHeight = fs * 0.62 + 'px';
    };
    size();
    window.addEventListener('resize', size);
    const t0 = performance.now();
    let raf = 0, last = 0, prev = '';
    const loop = (now) => {
      raf = requestAnimationFrame(loop);
      if (now - last < 32) return;
      last = now;
      const s = renderTitle((now - t0) / 1000 * 0.8);
      if (s !== prev) { el.textContent = s; prev = s; }
    };
    raf = requestAnimationFrame(loop);
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', size); };
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
        color: '#ffffff', fontWeight: 700,
        textShadow: '0 0 1px #0a0a0a, 0 0 3px #0a0a0a, 0 0 10px rgba(10,10,10,0.75), 0 0 24px rgba(10,10,10,0.5)',
        pointerEvents: 'none', zIndex: 1, userSelect: 'none',
        margin: 0,
      }}
    />
  );
}
