// Garderobe — ASCII Background
// Cycles between three effects: plasma, wire sphere, tunnel.
// Drop-in React component; auto-fits its parent; ResizeObserver-aware.
//
// Usage:
//   <div style={{ position:'relative', width:'100%', height:'100vh' }}>
//     <AsciiBackground opacity={0.22} />
//     {/* content above on a higher zIndex */}
//   </div>

import React, { useEffect, useRef } from 'react';

const FONT_MONO = "'JetBrains Mono', ui-monospace, Menlo, Consolas, monospace";

// ─────────────────────────────────────────────────────────────
// Effect 1 — Plasma field
// ─────────────────────────────────────────────────────────────
const PLASMA_CHARS = " .'`,-:;~+=*xX#%@";
// eslint-disable-next-line react-refresh/only-export-components
export function bgPlasma(t, cols, rows) {
  const ax = 2.0; // charH/charW compensation
  let s = '';
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = (c - cols / 2) / (cols / 2);
      const y = ((r - rows / 2) / (rows / 2)) * ax;
      const v =
        Math.sin(x * 4 + t * 1.4) +
        Math.sin(y * 5 - t * 0.9) +
        Math.sin(x * 3 + y * 3 + t * 0.7) +
        Math.sin(Math.sqrt(x * x + y * y) * 6 - t * 1.8);
      const n = (v + 4) / 8;
      const i = Math.max(0, Math.min(PLASMA_CHARS.length - 1, (n * (PLASMA_CHARS.length - 1)) | 0));
      s += PLASMA_CHARS[i];
    }
    s += '\n';
  }
  return s;
}

// ─────────────────────────────────────────────────────────────
// Effect 2 — Wire sphere (lat/lon grid, two-axis rotation, z-buffer)
// ─────────────────────────────────────────────────────────────
// eslint-disable-next-line react-refresh/only-export-components
export function bgSphere(t, cols, rows) {
  const out = new Array(cols * rows).fill(' ');
  const z = new Array(cols * rows).fill(-Infinity);
  const chars = '·:;=!*o#0@';
  const R = Math.min(cols * 0.36 * 0.5, rows * 0.42);
  const cx = cols / 2, cy = rows / 2;
  const A = t * 0.6, B = t * 0.4;
  const cosA = Math.cos(A), sinA = Math.sin(A);
  const cosB = Math.cos(B), sinB = Math.sin(B);

  const plot = (lat, lon) => {
    const cl = Math.cos(lat);
    const x = cl * Math.cos(lon);
    const y = Math.sin(lat);
    const zc = cl * Math.sin(lon);
    const x2 = x * cosA + zc * sinA;
    const z2 = -x * sinA + zc * cosA;
    const y2 = y * cosB - z2 * sinB;
    const z3 = y * sinB + z2 * cosB;
    if (z3 < -0.05) return; // backface cull
    const px = (cx + (x2 * R) / 0.5) | 0;
    const py = (cy - y2 * R) | 0;
    if (px < 0 || px >= cols || py < 0 || py >= rows) return;
    const idx = py * cols + px;
    if (z3 > z[idx]) {
      z[idx] = z3;
      const li = Math.max(0, Math.min(chars.length - 1, (((z3 + 1) / 2) * (chars.length - 1)) | 0));
      out[idx] = chars[li];
    }
  };

  for (let lat = -Math.PI / 2; lat <= Math.PI / 2 + 0.001; lat += Math.PI / 9) {
    for (let lon = 0; lon <= 2 * Math.PI; lon += 0.025) plot(lat, lon);
  }
  for (let lon = 0; lon < 2 * Math.PI; lon += Math.PI / 9) {
    for (let lat = -Math.PI / 2; lat <= Math.PI / 2; lat += 0.025) plot(lat, lon);
  }

  let s = '';
  for (let r = 0; r < rows; r++) s += out.slice(r * cols, (r + 1) * cols).join('') + '\n';
  return s;
}

// ─────────────────────────────────────────────────────────────
// Effect 3 — Hypertunnel (polar coords, scrolling sine pattern)
// ─────────────────────────────────────────────────────────────
const TUNNEL_CHARS = ' .,:;-=+*#%@';
// eslint-disable-next-line react-refresh/only-export-components
export function bgTunnel(t, cols, rows) {
  const ax = 2.0;
  let s = '';
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = (c - cols / 2) / (cols / 2);
      const y = ((r - rows / 2) / (rows / 2)) * ax;
      const d = Math.sqrt(x * x + y * y) + 1e-6;
      const a = Math.atan2(y, x);
      const u = 1 / d + t * 0.9;
      const v = (a / Math.PI) * 6 + t * 0.3;
      const p = (Math.sin(u * 2) + Math.sin(v * 3) + Math.sin(u + v)) / 3;
      const fade = Math.min(1, d * 1.4);
      const n = (p * 0.5 + 0.5) * fade;
      const i = Math.max(0, Math.min(TUNNEL_CHARS.length - 1, (n * (TUNNEL_CHARS.length - 1)) | 0));
      s += TUNNEL_CHARS[i];
    }
    s += '\n';
  }
  return s;
}

// ─────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────
const EFFECTS = {
  plasma: bgPlasma,
  sphere: bgSphere,
  tunnel: bgTunnel,
};
const EFFECT_KEYS = Object.keys(EFFECTS);
const STORAGE_KEY = 'garderobe.bg.effect';

function pickEffect(mode, persist) {
  if (mode && mode !== 'random' && EFFECTS[mode]) return mode;
  if (persist) {
    try {
      const cached = sessionStorage.getItem(STORAGE_KEY);
      if (cached && EFFECTS[cached]) return cached;
    } catch { /* ignore */ }
  }
  const pick = EFFECT_KEYS[(Math.random() * EFFECT_KEYS.length) | 0];
  if (persist) {
    try { sessionStorage.setItem(STORAGE_KEY, pick); } catch { /* ignore */ }
  }
  return pick;
}

export function AsciiBackground({
  opacity = 0.22,
  effect = 'random',
  persist = true,
  fps = 30,
  fontSize = 12,
}) {
  const ref = useRef(null);
  const dimsRef = useRef({ cols: 120, rows: 60 });
  const effectKeyRef = useRef(pickEffect(effect, persist));

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fn = EFFECTS[effectKeyRef.current];

    el.style.fontSize = fontSize + 'px';
    el.style.lineHeight = fontSize + 'px';

    const measure = () => {
      const probe = document.createElement('span');
      probe.style.cssText =
        'position:absolute;visibility:hidden;white-space:pre;font-family:' + FONT_MONO;
      probe.style.fontSize = fontSize + 'px';
      probe.textContent = 'M'.repeat(50);
      el.parentElement.appendChild(probe);
      const r = probe.getBoundingClientRect();
      const charW = r.width / 50;
      const charH = parseFloat(el.style.lineHeight) || charW * 1.2;
      probe.remove();
      const parent = el.parentElement.getBoundingClientRect();
      const cols = Math.max(40, Math.floor(parent.width / charW) + 2);
      const rows = Math.max(20, Math.floor(parent.height / charH) + 2);
      dimsRef.current = { cols, rows };
    };
    measure();

    let raf = 0;
    const start = performance.now();
    const interval = 1000 / fps;
    let last = 0;

    const tick = (now) => {
      raf = requestAnimationFrame(tick);
      if (now - last < interval) return;
      last = now;
      const t = (now - start) / 1000;
      const { cols, rows } = dimsRef.current;
      el.textContent = fn(t, cols, rows);
    };
    raf = requestAnimationFrame(tick);

    const ro = new ResizeObserver(() => measure());
    ro.observe(el.parentElement);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [fontSize, fps]);

  return (
    <pre
      ref={ref}
      style={{
        position: 'absolute',
        inset: 0,
        margin: 0,
        fontFamily: FONT_MONO,
        whiteSpace: 'pre',
        color: `rgba(245,242,234,${opacity})`,
        pointerEvents: 'none',
        userSelect: 'none',
        overflow: 'hidden',
        zIndex: 0,
      }}
    />
  );
}

export default AsciiBackground;
