import { useEffect, useRef } from 'react';
import { buildScatterFrame, SC_PERIM_LEN } from '../lib/ascii';

// Positions converted from original (cards were mounted on 50%-wide door elements)
// door=left: viewport_x = door_x / 2
// door=right: viewport_x = 50 + door_x / 2
const SCATTER_LAYOUT = [
  { x:  3, y:  5, rot: -14 },  // door=left,  x=6
  { x: 75, y:  4, rot:  12 },  // door=right, x=50
  { x:  2, y: 58, rot:  18 },  // door=left,  x=4
  { x: 79, y: 55, rot: -16 },  // door=right, x=58
  { x: 36, y: 76, rot:  -8 },  // door=left,  x=72
];

function applyTilt(card) {
  const shine = card.querySelector('.card-shine');
  card.addEventListener('mousemove', e => {
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
    card.style.transform = '';
    if (shine) shine.style.opacity = '0';
  });
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

      const imgHtml = imgUrl
        ? `<img src="${imgUrl}" loading="lazy" />`
        : '';
      card.insertAdjacentHTML('beforeend', `
        <div class="card-image-area">
          ${imgHtml}
          <div class="card-shine"></div>
        </div>
      `);

      wrap.appendChild(card);
      container.appendChild(wrap);
      applyTilt(card);
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
