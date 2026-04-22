import { useEffect, useRef } from 'react';
import { buildScatterFrame, SC_PERIM_LEN } from '../lib/ascii';
import { gyroState, gyroCallbacks, isGyroActive, requestGyroPermission } from '../lib/gyro';

const SCATTER_LAYOUT = [
  { x:  3, y:  5, rot: -14 },
  { x: 75, y:  4, rot:  12 },
  { x:  2, y: 58, rot:  18 },
  { x: 79, y: 55, rot: -16 },
  { x: 36, y: 76, rot:  -8 },
];

function applyTilt(card) {
  const shine = card.querySelector('.card-shine');

  card.addEventListener('pointerdown', requestGyroPermission);
  card.addEventListener('mousemove', e => {
    if (isGyroActive()) return;
    const rect = card.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width - 0.5;
    const y = (e.clientY - rect.top)  / rect.height - 0.5;
    card.style.transform = `perspective(500px) rotateY(${x*16}deg) rotateX(${-y*16}deg) scale(1.06) translateZ(10px)`;
    if (shine) {
      shine.style.opacity = '1';
      shine.style.background = `linear-gradient(${115+x*30}deg,transparent 30%,rgba(255,255,255,${0.1+Math.abs(x)*0.1}) 50%,transparent 70%)`;
    }
  });
  card.addEventListener('mouseleave', () => {
    if (isGyroActive()) return;
    card.style.transform = '';
    if (shine) shine.style.opacity = '0';
  });

  const cb = () => {
    const x = Math.max(-1, Math.min(1, gyroState.x));
    const y = Math.max(-1, Math.min(1, gyroState.y));
    card.style.transform = `perspective(600px) rotateY(${x*14}deg) rotateX(${-y*14}deg) scale(1.02)`;
    if (shine) {
      shine.style.opacity = '0.5';
      shine.style.background = `linear-gradient(${115+x*30}deg,transparent 30%,rgba(255,255,255,${0.12+Math.abs(x)*0.12}) 50%,transparent 70%)`;
    }
  };
  gyroCallbacks.add(cb);
  return cb;
}

export default function ScatterCards() {
  const containerRef = useRef(null);
  const animRef      = useRef(null);
  const itemsRef     = useRef([]);

  useEffect(() => {
    let imgUrls = [];
    try { imgUrls = JSON.parse(localStorage.getItem('garderobe-preview-imgs') || '[]'); } catch {}
    for (let i = imgUrls.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [imgUrls[i], imgUrls[j]] = [imgUrls[j], imgUrls[i]];
    }

    const container = containerRef.current;
    if (!container) return;
    itemsRef.current = [];
    const gyroCbs = [];

    SCATTER_LAYOUT.forEach((pos, i) => {
      const imgUrl = imgUrls.length ? imgUrls[i % imgUrls.length] : '';

      const wrap = document.createElement('div');
      wrap.className = 'scatter-wrap';
      wrap.style.cssText = `position:absolute;display:inline-block;pointer-events:all;z-index:2;left:${pos.x}%;top:${pos.y}%;transform:rotate(${pos.rot}deg)`;

      const card = document.createElement('div');
      card.className = 'scatter-card';

      const frame = document.createElement('pre');
      frame.className = 'scatter-ascii-frame';
      frame.textContent = buildScatterFrame((i * 13) % SC_PERIM_LEN);
      card.appendChild(frame);

      const imgHtml = imgUrl ? `<img src="${imgUrl}" loading="lazy" />` : '';
      card.insertAdjacentHTML('beforeend', `
        <div class="card-image-area">
          ${imgHtml}
          <div class="card-shine"></div>
        </div>
      `);

      wrap.appendChild(card);
      container.appendChild(wrap);
      gyroCbs.push(applyTilt(card));
      itemsRef.current.push({ preEl: frame, offset: (i * 13) % SC_PERIM_LEN });
    });

    animRef.current = setInterval(() => {
      itemsRef.current.forEach(sc => {
        sc.offset = (sc.offset + 1) % SC_PERIM_LEN;
        if (sc.preEl) sc.preEl.textContent = buildScatterFrame(sc.offset);
      });
    }, 60);

    return () => {
      clearInterval(animRef.current);
      gyroCbs.forEach(cb => gyroCallbacks.delete(cb));
      if (container) container.innerHTML = '';
    };
  }, []);

  return (
    <div
      ref={containerRef}
      style={{ position: 'absolute', inset: 0, zIndex: 0, overflow: 'hidden', pointerEvents: 'none' }}
    />
  );
}
