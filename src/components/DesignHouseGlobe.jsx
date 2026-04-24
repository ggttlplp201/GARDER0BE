import { useRef, useEffect, useState, useCallback } from 'react';
import { geoOrthographic, geoPath, geoGraticule } from 'd3-geo';
import { feature } from 'topojson-client';
import worldData from 'world-atlas/countries-110m.json';

const INIT_ROTY  = -0.18;
const INIT_ROTX  =  0.50;
const IDLE_SPEED =  0.004;
const FRICTION   =  0.88;
const ROTX_MIN   = -1.3;
const ROTX_MAX   =  1.3;
const PIN_R      =  4.5;
const CLUSTER_R  = 11;
const CLUSTER_D      = PIN_R * 2.6;
const GEO_STACK_DEG  = 0.15;
const MINI_SIZE  = 218;  // px — collapsed size in header-right
const ZOOM_SIZE  = 380;  // px — expanded size when zoomed in mini mode
const ZOOM_CLIP  = 28;   // fixed clip angle (°) for all zoom-ins

const LAND      = (() => { try { return feature(worldData, worldData.objects.land); } catch { return null; } })();
const GRATICULE = geoGraticule().step([30, 30])();

const HOUSES = [
  // Paris — Golden Triangle / 8th arr / 1st arr
  { name: 'Chanel',            city: 'Paris',    country: 'France', lat: 48.8657, lng:   2.3291, tz: 'Europe/Paris'    }, // 31 Rue Cambon
  { name: 'Louis Vuitton',     city: 'Paris',    country: 'France', lat: 48.8716, lng:   2.3005, tz: 'Europe/Paris'    }, // 101 Ave des Champs-Élysées
  { name: 'Dior',              city: 'Paris',    country: 'France', lat: 48.8667, lng:   2.3061, tz: 'Europe/Paris'    }, // 30 Ave Montaigne
  { name: 'Balenciaga',        city: 'Paris',    country: 'France', lat: 48.8663, lng:   2.3014, tz: 'Europe/Paris'    }, // 10 Ave George V
  { name: 'Saint Laurent',     city: 'Paris',    country: 'France', lat: 48.8668, lng:   2.3054, tz: 'Europe/Paris'    }, // 35 Ave Montaigne
  { name: 'Givenchy',          city: 'Paris',    country: 'France', lat: 48.8660, lng:   2.3009, tz: 'Europe/Paris'    }, // 36 Ave George V
  { name: 'Hermès',            city: 'Paris',    country: 'France', lat: 48.8689, lng:   2.3217, tz: 'Europe/Paris'    }, // 24 Rue du Faubourg Saint-Honoré
  // Milan — Quadrilatero della Moda
  { name: 'Prada',             city: 'Milan',    country: 'Italy',  lat: 45.4700, lng:   9.1971, tz: 'Europe/Rome'     }, // Via della Spiga 18
  { name: 'Versace',           city: 'Milan',    country: 'Italy',  lat: 45.4699, lng:   9.1955, tz: 'Europe/Rome'     }, // Via Gesù 12
  { name: 'Dolce & Gabbana',   city: 'Milan',    country: 'Italy',  lat: 45.4714, lng:   9.1973, tz: 'Europe/Rome'     }, // Via della Spiga 2
  // Rome — Spanish Steps area
  { name: 'Valentino',         city: 'Rome',     country: 'Italy',  lat: 41.9031, lng:  12.4820, tz: 'Europe/Rome'     }, // Via Condotti 13
  { name: 'Fendi',             city: 'Rome',     country: 'Italy',  lat: 41.9043, lng:  12.4797, tz: 'Europe/Rome'     }, // Largo Goldoni 420
  // Florence & Vicenza
  { name: 'Gucci',             city: 'Florence', country: 'Italy',  lat: 43.7696, lng:  11.2558, tz: 'Europe/Rome'     }, // Piazza della Signoria 10
  { name: 'Bottega Veneta',    city: 'Vicenza',  country: 'Italy',  lat: 45.5455, lng:  11.5356, tz: 'Europe/Rome'     }, // Vicenza centro
  // London — Mayfair
  { name: 'Burberry',          city: 'London',   country: 'UK',     lat: 51.5115, lng:  -0.1390, tz: 'Europe/London'   }, // 121 Regent Street
  { name: 'Alexander McQueen', city: 'London',   country: 'UK',     lat: 51.5093, lng:  -0.1438, tz: 'Europe/London'   }, // 4-5 Old Bond Street
  // Tokyo — Minami-Aoyama
  { name: 'Comme des Garçons', city: 'Tokyo',    country: 'Japan',  lat: 35.6641, lng: 139.7186, tz: 'Asia/Tokyo'      }, // 5-2-1 Minami-Aoyama
  { name: 'Yohji Yamamoto',    city: 'Tokyo',    country: 'Japan',  lat: 35.6638, lng: 139.7194, tz: 'Asia/Tokyo'      }, // 5-3-6 Minami-Aoyama
  // New York — Upper East Side
  { name: 'Ralph Lauren',      city: 'New York', country: 'USA',    lat: 40.7731, lng: -73.9631, tz: 'America/New_York' }, // 867 Madison Ave
  { name: 'Calvin Klein',      city: 'New York', country: 'USA',    lat: 40.7636, lng: -73.9706, tz: 'America/New_York' }, // 654 Madison Ave
];

function localTime(tz, now) {
  try {
    return now.toLocaleTimeString('en-US', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: true });
  } catch { return ''; }
}

function solarPosition() {
  const now = new Date();
  const n   = now / 86400000 + 2440587.5 - 2451545.0;
  const L   = (280.46 + 0.9856474 * n) % 360;
  const g   = ((357.528 + 0.9856003 * n) % 360) * Math.PI / 180;
  const lam = (L + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * Math.PI / 180;
  const lat = Math.asin(Math.sin(23.439 * Math.PI / 180) * Math.sin(lam)) * 180 / Math.PI;
  const utcH = now.getUTCHours() + now.getUTCMinutes() / 60 + now.getUTCSeconds() / 3600;
  return [-(utcH - 12) * 15, lat];
}

function nightCircle(sunLng, sunLat) {
  const aLng = sunLng + 180, aLat = -sunLat;
  const lat0 = aLat * Math.PI / 180, lng0 = aLng * Math.PI / 180;
  const coords = [];
  for (let i = 0; i <= 72; i++) {
    const angle = (i / 72) * 2 * Math.PI;
    const lat1  = Math.asin(Math.sin(lat0) * 0 + Math.cos(lat0) * Math.cos(angle));
    const dlng  = Math.atan2(Math.sin(angle) * Math.cos(lat0), -Math.sin(lat0) * Math.sin(lat1));
    coords.push([(lng0 + dlng) * 180 / Math.PI, lat1 * 180 / Math.PI]);
  }
  return { type: 'Polygon', coordinates: [coords] };
}

function buildZoomedClusters(visible) {
  const used = new Set();
  const out  = [];
  for (let a = 0; a < visible.length; a++) {
    if (used.has(a)) continue;
    const group = [a];
    for (let b = a + 1; b < visible.length; b++) {
      if (used.has(b)) continue;
      if (Math.hypot(visible[a].lat - visible[b].lat, visible[a].lng - visible[b].lng) < GEO_STACK_DEG)
        group.push(b);
    }
    for (const i of group) used.add(i);
    const n   = group.length;
    const sx  = group.reduce((s, i) => s + visible[i].sx, 0) / n;
    const sy  = group.reduce((s, i) => s + visible[i].sy, 0) / n;
    const lat = group.reduce((s, i) => s + visible[i].lat, 0) / n;
    const lng = group.reduce((s, i) => s + visible[i].lng, 0) / n;
    const h0  = HOUSES[visible[group[0]].i];
    out.push({ sx, sy, lat, lng, count: n, indices: group.map(i => visible[i].i),
               label: `${h0.city}, ${h0.country}`, isStack: true });
  }
  return out;
}

function buildClusters(visible) {
  const used = new Set();
  const out  = [];
  for (let a = 0; a < visible.length; a++) {
    if (used.has(a)) continue;
    const group = [a];
    for (let b = a + 1; b < visible.length; b++) {
      if (used.has(b)) continue;
      if (Math.hypot(visible[a].sx - visible[b].sx, visible[a].sy - visible[b].sy) < CLUSTER_D)
        group.push(b);
    }
    for (const i of group) used.add(i);
    const n      = group.length;
    const sx     = group.reduce((s, i) => s + visible[i].sx, 0) / n;
    const sy     = group.reduce((s, i) => s + visible[i].sy, 0) / n;
    const lat    = group.reduce((s, i) => s + visible[i].lat, 0) / n;
    const lng    = group.reduce((s, i) => s + visible[i].lng, 0) / n;
    const cities = [...new Set(group.map(i => visible[i].city))];
    out.push({ sx, sy, lat, lng, count: n, indices: group.map(i => visible[i].i),
               label: cities.length === 1 ? cities[0] : `${cities[0]} +${cities.length - 1}` });
  }
  return out;
}

export default function DesignHouseGlobe({ mini = false }) {
  const canvasRef    = useRef(null);
  const containerRef = useRef(null);
  const rotYRef      = useRef(INIT_ROTY);
  const rotXRef      = useRef(INIT_ROTX);
  const velYRef      = useRef(IDLE_SPEED);
  const velXRef      = useRef(0);
  const clipRef      = useRef(90);
  const flyRef       = useRef(null);
  const animRef      = useRef(null);
  const dragRef      = useRef(null);
  const clustersRef  = useRef([]);
  const hovIdxRef    = useRef(null);
  const miniRef      = useRef(mini);

  const lastDrawRef   = useRef(0);
  const sizeRef       = useRef(MINI_SIZE);
  const nowRef        = useRef(new Date());
  // Performance caches — values that are expensive to recompute every frame
  const solarCacheRef = useRef({ lng: 0, lat: 0, night: null, ts: 0 });
  const gradCacheRef  = useRef({ W: 0, H: 0, r: 0, isDark: null, atmos: null, hl: null, dark: null });
  const labelCacheRef = useRef({ key: '', measured: [] });
  const pausedRef     = useRef(false);

  const [hovCluster, setHovCluster] = useState(null);
  const [dragging, setDragging]     = useState(false);
  const [tooltipPos, setTooltip]    = useState({ x: 0, y: 0 });
  const [containerW, setContainerW] = useState(mini ? MINI_SIZE : 400);
  const [isZoomed, setIsZoomed]     = useState(false);
  const [showBack, setShowBack]     = useState(false);
  const isZoomedRef                 = useRef(false);
  const [now, setNow]               = useState(() => new Date());

  // Tick local time every minute
  useEffect(() => {
    const t = setInterval(() => { const d = new Date(); nowRef.current = d; setNow(d); }, 60000);
    return () => clearInterval(t);
  }, []);

  // Pause RAF when tab is hidden
  useEffect(() => {
    const onVis = () => { pausedRef.current = document.hidden; };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  // Pause RAF when globe is scrolled off-screen
  useEffect(() => {
    const ct = containerRef.current;
    if (!ct) return;
    const io = new IntersectionObserver(
      ([entry]) => { pausedRef.current = !entry.isIntersecting || document.hidden; },
      { threshold: 0 }
    );
    io.observe(ct);
    return () => io.disconnect();
  }, []);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx  = canvas.getContext('2d');
    const dpr  = window.devicePixelRatio || 1;
    const W    = canvas.width  / dpr;
    const H    = canvas.height / dpr;
    const cx   = W / 2, cy = H / 2;
    const r    = Math.min(W, H) * 0.43;
    const ca   = clipRef.current;
    const scale = r / Math.sin(ca * Math.PI / 180);

    const isMini = miniRef.current;
    const pR  = isMini ? 3 : PIN_R;
    const cR  = isMini ? 7 : CLUSTER_R;

    const rotY   = rotYRef.current;
    const rotX   = rotXRef.current;
    const isDark = document.documentElement.classList.contains('dark');
    const fg     = isDark ? '#e8e8e8' : '#000000';
    const bg     = isDark ? '#0d0d0d' : '#ffffff';
    const land   = isDark ? '#272727' : '#dfdfdf';

    const proj = geoOrthographic()
      .scale(scale).translate([cx, cy])
      .clipAngle(ca)
      .rotate([rotY * 180 / Math.PI, -rotX * 180 / Math.PI]);
    const path = geoPath(proj, ctx);

    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, W, H);

    ctx.beginPath(); path({ type: 'Sphere' });
    ctx.fillStyle = bg; ctx.fill();
    ctx.strokeStyle = fg; ctx.lineWidth = 1.5; ctx.stroke();

    if (LAND) { ctx.beginPath(); path(LAND); ctx.fillStyle = land; ctx.fill(); }

    // Solar position + night overlay — recompute at most every 30 s
    const _sNow = Date.now();
    const _sc   = solarCacheRef.current;
    if (_sNow - _sc.ts > 30000 || !_sc.night) {
      const [_lng, _lat] = solarPosition();
      solarCacheRef.current = { lng: _lng, lat: _lat, night: nightCircle(_lng, _lat), ts: _sNow };
    }
    const { lng: sunLng, lat: sunLat, night } = solarCacheRef.current;
    ctx.beginPath(); path(night);
    ctx.fillStyle = isDark ? 'rgba(0,0,0,0.45)' : 'rgba(0,0,0,0.13)';
    ctx.fill();

    if (!isMini) {
      ctx.beginPath(); path(GRATICULE);
      ctx.strokeStyle = isDark ? 'rgba(232,232,232,0.20)' : 'rgba(0,0,0,0.18)';
      ctx.lineWidth = 0.7; ctx.stroke();
    }

    ctx.beginPath(); path(night);
    ctx.strokeStyle = isDark ? 'rgba(232,232,232,0.35)' : 'rgba(0,0,0,0.25)';
    ctx.lineWidth = 0.8; ctx.stroke();

    // City lights in dark mode — glowing dots at all visible design house locations
    if (isDark) {
      for (let i = 0; i < HOUSES.length; i++) {
        const h = HOUSES[i];
        const pos = proj([h.lng, h.lat]);
        if (!pos) continue;
        const [lx, ly] = pos;
        if (Math.hypot(lx - cx, ly - cy) > r - 2) continue;
        const gr = isMini ? 9 : 22;
        const glow = ctx.createRadialGradient(lx, ly, 0, lx, ly, gr);
        glow.addColorStop(0,   'rgba(255,240,160,0.95)');
        glow.addColorStop(0.25,'rgba(255,210,100,0.55)');
        glow.addColorStop(0.6, 'rgba(255,180,60,0.18)');
        glow.addColorStop(1,   'transparent');
        ctx.beginPath(); ctx.arc(lx, ly, gr, 0, Math.PI * 2);
        ctx.fillStyle = glow; ctx.fill();
      }
    }

    // 3D atmosphere + lighting gradients — cached; only rebuilt when size or theme changes
    const _gc = gradCacheRef.current;
    if (_gc.W !== W || _gc.H !== H || _gc.r !== r || _gc.isDark !== isDark) {
      const _atmos = ctx.createRadialGradient(cx, cy, r * 0.72, cx, cy, r * 1.0);
      _atmos.addColorStop(0, 'transparent');
      _atmos.addColorStop(1, isDark ? 'rgba(120,160,255,0.22)' : 'rgba(100,140,255,0.14)');
      const _hlx = cx - r * 0.28, _hly = cy - r * 0.30;
      const _hl = ctx.createRadialGradient(_hlx, _hly, 0, _hlx, _hly, r * 0.52);
      _hl.addColorStop(0, isDark ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.30)');
      _hl.addColorStop(1, 'transparent');
      const _dark = ctx.createRadialGradient(cx + r * 0.20, cy + r * 0.20, r * 0.45, cx, cy, r);
      _dark.addColorStop(0, 'transparent');
      _dark.addColorStop(1, isDark ? 'rgba(0,0,0,0.32)' : 'rgba(0,0,0,0.18)');
      gradCacheRef.current = { W, H, r, isDark, atmos: _atmos, hl: _hl, dark: _dark };
    }
    const { atmos: atmosGrad, hl: hlGrad, dark: darkGrad } = gradCacheRef.current;

    // 3D atmospheric rim — blue-white halo at the sphere edge
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = atmosGrad; ctx.fill();

    // 3D specular highlight — top-left light source
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = hlGrad; ctx.fill();

    // Limb darkening — subtle shadow toward the bottom-right edge
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = darkGrad; ctx.fill();

    const visible = [];
    for (let i = 0; i < HOUSES.length; i++) {
      const pos = proj([HOUSES[i].lng, HOUSES[i].lat]);
      if (!pos) continue;
      const [sx, sy] = pos;
      if (Math.hypot(sx - cx, sy - cy) > r - 2) continue;
      visible.push({ i, sx, sy, lat: HOUSES[i].lat, lng: HOUSES[i].lng, city: HOUSES[i].city });
    }
    const clusters = isZoomedRef.current ? buildZoomedClusters(visible) : buildClusters(visible);
    clustersRef.current = clusters;

    const hovIdx = hovIdxRef.current;

    for (let ci = 0; ci < clusters.length; ci++) {
      const { sx, sy, count, isStack } = clusters[ci];
      const isHov = hovIdx === ci;

      if (count > 1 && !isStack) {
        const cr = isHov ? cR * 1.15 : cR;
        ctx.beginPath();
        ctx.arc(sx, sy, cr, 0, Math.PI * 2);
        ctx.fillStyle = fg; ctx.fill();
        ctx.fillStyle = bg;
        ctx.font      = `bold ${Math.round(cr * 0.72)}px Arial`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(`+${count}`, sx, sy);
        if (isHov) {
          ctx.beginPath(); ctx.arc(sx, sy, cr + 3, 0, Math.PI * 2);
          ctx.strokeStyle = fg; ctx.lineWidth = 1; ctx.stroke();
        }
      } else {
        const pr = isHov ? pR * 1.7 : pR;
        ctx.beginPath(); ctx.arc(sx, sy, pr, 0, Math.PI * 2);
        ctx.fillStyle = isHov ? fg : bg; ctx.fill();
        ctx.strokeStyle = fg; ctx.lineWidth = isHov ? 2 : 1.5; ctx.stroke();
        if (isHov && !isMini) {
          ctx.beginPath();
          ctx.moveTo(sx - pr * 2.2, sy); ctx.lineTo(sx + pr * 2.2, sy);
          ctx.moveTo(sx, sy - pr * 2.2); ctx.lineTo(sx, sy + pr * 2.2);
          ctx.strokeStyle = fg; ctx.lineWidth = 1; ctx.stroke();
        }
      }
    }
    // Auto-labels when zoomed — with iterative overlap separation
    if (isZoomedRef.current) {
      const nowT = nowRef.current;
      const stemLen = 32;
      const padX = 5, padY = 4, lineH = 11;
      const boxGap = 4;

      // Cache text measurement (ctx.measureText + textLines) by minute + visible cluster set.
      // Positions (sx,sy) are re-derived each frame from current cluster data; only the
      // expensive text layout work is cached.
      const _labKey = nowT.getMinutes() + '|' + clusters.map(c => c.indices.join(',')).join('|');
      if (_labKey !== labelCacheRef.current.key) {
        const _measured = clusters.map(cl => {
          const { indices, isStack, count } = cl;
          const h0 = HOUSES[indices[0]];
          const textLines = [];
          if (isStack && count > 1) {
            textLines.push({ text: h0.city, bold: true, sz: 8 });
            for (const idx of indices) textLines.push({ text: HOUSES[idx].name, bold: false, sz: 7.5 });
            textLines.push({ text: localTime(h0.tz, nowT), bold: false, sz: 7, dim: true });
          } else {
            textLines.push({ text: h0.name, bold: true, sz: 8 });
            textLines.push({ text: `${h0.city} · ${localTime(h0.tz, nowT)}`, bold: false, sz: 7, dim: true });
          }
          let maxW = 0;
          for (const l of textLines) {
            ctx.font = `${l.bold ? 'bold ' : ''}${l.sz}px Arial`;
            maxW = Math.max(maxW, ctx.measureText(l.text).width);
          }
          return { textLines, bw: maxW + padX * 2, bh: textLines.length * lineH + padY * 2 };
        });
        labelCacheRef.current = { key: _labKey, measured: _measured };
      }
      const { measured } = labelCacheRef.current;

      // Build per-frame lab positions from current cluster screen coordinates + cached measurements
      const labs = clusters.map((cl, ci) => {
        const { sx, sy } = cl;
        const { bw, bh, textLines } = measured[ci];
        const dx = sx - cx, dy = sy - cy;
        const dist = Math.hypot(dx, dy) || 1;
        const ux = dist < 10 ? 0 : dx / dist;
        const uy = dist < 10 ? -1 : dy / dist;
        const toRight = ux >= 0;
        const stemX = sx + ux * stemLen;
        const stemY = sy + uy * stemLen;
        return { sx, sy, ux, uy, toRight, stemX, stemY,
                 bx: toRight ? stemX + 4 : stemX - bw - 4,
                 by: stemY - bh / 2, bw, bh, textLines };
      });

      // Iterative vertical separation
      for (let iter = 0; iter < 20; iter++) {
        let moved = false;
        for (let a = 0; a < labs.length; a++) {
          for (let b = a + 1; b < labs.length; b++) {
            const la = labs[a], lb = labs[b];
            if (la.bx + la.bw < lb.bx - boxGap || lb.bx + lb.bw < la.bx - boxGap) continue;
            const overlap = (la.by + la.bh + boxGap) - lb.by;
            if (overlap <= 0) continue;
            const half = overlap / 2;
            labs[a].by -= half;
            labs[b].by += half;
            moved = true;
          }
        }
        if (!moved) break;
      }

      // Draw all labels with final positions
      for (const lab of labs) {
        const { sx, sy, ux, uy, toRight, stemX, stemY, bx, bw, bh, by, textLines } = lab;
        const pr = pR;
        const boxMidY = by + bh / 2;

        // L-shaped line: dot edge → stem → box edge
        ctx.beginPath();
        ctx.moveTo(sx + ux * (pr + 2), sy + uy * (pr + 2));
        ctx.lineTo(stemX, stemY);
        if (Math.abs(stemY - boxMidY) > 2) ctx.lineTo(stemX, boxMidY);
        ctx.lineTo(toRight ? bx : bx + bw, boxMidY);
        ctx.strokeStyle = isDark ? 'rgba(220,220,220,0.5)' : 'rgba(0,0,0,0.35)';
        ctx.lineWidth = 0.7; ctx.stroke();

        // Box
        ctx.fillStyle = isDark ? 'rgba(13,13,13,0.88)' : 'rgba(255,255,255,0.9)';
        ctx.strokeStyle = isDark ? 'rgba(200,200,200,0.2)' : 'rgba(0,0,0,0.12)';
        ctx.lineWidth = 0.8;
        ctx.fillRect(bx, by, bw, bh);
        ctx.strokeRect(bx, by, bw, bh);

        // Text
        ctx.textBaseline = 'top'; ctx.textAlign = 'left';
        textLines.forEach((l, i) => {
          ctx.font = `${l.bold ? 'bold ' : ''}${l.sz}px Arial`;
          ctx.fillStyle = l.dim ? (isDark ? '#888' : '#aaa') : fg;
          ctx.fillText(l.text, bx + padX, by + padY + i * lineH);
        });
      }
    }

    ctx.restore();
  }, []);

  // Animation loop — full 60fps during interaction, ~20fps when idle
  useEffect(() => {
    function frame(ts) {
      if (pausedRef.current) { animRef.current = requestAnimationFrame(frame); return; }
      const isActive = dragRef.current || flyRef.current || hovIdxRef.current !== null;
      const interval = isActive ? 16 : 50;

      if (ts - lastDrawRef.current >= interval) {
        if (flyRef.current && !dragRef.current) {
          const f   = flyRef.current;
          const eY  = f.tRotY - rotYRef.current;
          const eX  = f.tRotX - rotXRef.current;
          const eC  = f.tClip - clipRef.current;
          const eSz = (f.tSize ?? sizeRef.current) - sizeRef.current;
          rotYRef.current += eY  * 0.05;
          rotXRef.current += eX  * 0.05;
          clipRef.current += eC  * 0.05;
          sizeRef.current += eSz * 0.05;

          // Apply canvas/container size directly (keeps it in sync with clip angle)
          if (miniRef.current && f.tSize !== undefined) {
            const s   = Math.round(sizeRef.current);
            const dpr = window.devicePixelRatio || 1;
            const cv  = canvasRef.current;
            const ct  = containerRef.current;
            if (cv) {
              const tw = s * dpr;
              // Only reset backing store when size actually changes (setting canvas.width clears it)
              if (cv.width !== tw) { cv.width = tw; cv.height = tw; }
              cv.style.width = `${s}px`; cv.style.height = `${s}px`;
            }
            if (ct) { ct.style.width = `${s}px`; ct.style.height = `${s}px`; }
          }

          if (Math.abs(eY) < 0.002 && Math.abs(eX) < 0.002 && Math.abs(eC) < 0.1 && Math.abs(eSz) < 1) {
            rotYRef.current = f.tRotY;
            rotXRef.current = f.tRotX;
            clipRef.current = f.tClip;
            sizeRef.current = f.tSize ?? sizeRef.current;
            flyRef.current  = null;
            if (f.tSize === ZOOM_SIZE) setIsZoomed(true);
            if (f.tSize === MINI_SIZE) setIsZoomed(false);
          }
          velYRef.current = 0; velXRef.current = 0;
        } else if (!dragRef.current && !isZoomedRef.current) {
          velYRef.current = velYRef.current * FRICTION + IDLE_SPEED * (1 - FRICTION);
          rotYRef.current += velYRef.current;
          if (Math.abs(velXRef.current) > 0.00005) {
            velXRef.current *= FRICTION;
            rotXRef.current  = Math.max(ROTX_MIN, Math.min(ROTX_MAX, rotXRef.current + velXRef.current));
          }
        } else if (!dragRef.current && isZoomedRef.current) {
          velYRef.current = velYRef.current * FRICTION + IDLE_SPEED * 0.25 * (1 - FRICTION);
          rotYRef.current += velYRef.current;
          velXRef.current = 0;
        }
        draw();
        lastDrawRef.current = ts;
      }
      animRef.current = requestAnimationFrame(frame);
    }
    animRef.current = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(animRef.current);
  }, [draw]);

  // Canvas sizing
  useEffect(() => {
    const canvas    = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const dpr = window.devicePixelRatio || 1;

    if (mini) {
      // In mini mode the frame loop owns canvas/container sizing during animation.
      // Just set the initial size here — no ResizeObserver (it would clear the canvas
      // every frame by resetting canvas.width between draw() calls).
      const s = MINI_SIZE;
      canvas.width = s * dpr; canvas.height = s * dpr;
      canvas.style.width = `${s}px`; canvas.style.height = `${s}px`;
      container.style.width = `${s}px`; container.style.height = `${s}px`;
      return;
    }

    function setSize(s) {
      canvas.width  = s * dpr; canvas.height = s * dpr;
      canvas.style.width = `${s}px`; canvas.style.height = `${s}px`;
      setContainerW(s);
    }

    function resize() {
      const s = Math.min(container.clientWidth, container.clientHeight);
      if (s > 0) setSize(s);
    }
    const ro = new ResizeObserver(resize);
    ro.observe(container); resize();
    return () => ro.disconnect();
  }, [mini]);

  const hitCluster = useCallback((mx, my) => {
    const cls = clustersRef.current;
    const pR  = miniRef.current ? 3 : PIN_R;
    const cR  = miniRef.current ? 7 : CLUSTER_R;
    for (let i = 0; i < cls.length; i++) {
      const hitR = cls[i].count > 1 && !cls[i].isStack ? cR + 5 : pR + 5;
      if (Math.hypot(mx - cls[i].sx, my - cls[i].sy) < hitR) return i;
    }
    return null;
  }, []);

  const onPointerDown = useCallback((e) => {
    velYRef.current = 0; velXRef.current = 0;
    flyRef.current  = null;
    dragRef.current = {
      startX: e.clientX, startY: e.clientY,
      startRotY: rotYRef.current, startRotX: rotXRef.current,
      moved: false,
    };
    setDragging(true);
    e.currentTarget.setPointerCapture(e.pointerId);
  }, []);

  const onPointerMove = useCallback((e) => {
    if (dragRef.current) {
      const { startX, startY, startRotY, startRotX } = dragRef.current;
      const dx = e.clientX - startX, dy = e.clientY - startY;
      if (Math.hypot(dx, dy) > 4) dragRef.current.moved = true;
      if (dragRef.current.moved) {
        const bw  = canvasRef.current?.getBoundingClientRect().width || 400;
        const fac = 1.4 / (bw * 0.43);
        const nY  = startRotY + dx * fac;
        const nX  = Math.max(ROTX_MIN, Math.min(ROTX_MAX, startRotX + dy * fac));
        velYRef.current = nY - rotYRef.current;
        velXRef.current = nX - rotXRef.current;
        rotYRef.current = nY; rotXRef.current = nX;
      }
      return;
    }
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mx   = e.clientX - rect.left, my = e.clientY - rect.top;
    const ci   = hitCluster(mx, my);
    if (ci !== hovIdxRef.current) {
      hovIdxRef.current = ci;
      setHovCluster(ci !== null ? (clustersRef.current[ci] ?? null) : null);
      if (ci !== null) setTooltip({ x: mx, y: my });
    }
  }, [hitCluster]);

  const onPointerUp = useCallback((e) => {
    if (dragRef.current && !dragRef.current.moved) {
      const canvas = canvasRef.current;
      const rect   = canvas?.getBoundingClientRect();
      if (rect) {
        const mx = e.clientX - rect.left, my = e.clientY - rect.top;
        const ci = hitCluster(mx, my);
        if (ci !== null && clustersRef.current[ci]?.count > 1 && !isZoomedRef.current) {
          const cl = clustersRef.current[ci];
          flyRef.current = {
            tRotY: -cl.lng * Math.PI / 180,
            tRotX:  cl.lat * Math.PI / 180,
            tClip: ZOOM_CLIP,
            tSize: ZOOM_SIZE,
          };
          isZoomedRef.current = true;
          hovIdxRef.current = null;
          setHovCluster(null);
          setShowBack(true);
        }
      }
    }
    dragRef.current = null;
    setDragging(false);
  }, [hitCluster]);

  const onMouseLeave = useCallback(() => {
    hovIdxRef.current = null;
    setHovCluster(null);
    setDragging(false);
  }, []);

  const handleBack = useCallback(() => {
    flyRef.current = { tRotY: rotYRef.current, tRotX: rotXRef.current, tClip: 90, tSize: MINI_SIZE };
    isZoomedRef.current = false;
    setIsZoomed(false);
    setShowBack(false);
  }, []);

  const hovHouse    = hovCluster?.count === 1 ? HOUSES[hovCluster.indices[0]] : null;
  const isHovStack  = hovCluster?.isStack && hovCluster.count > 1;
  const cursorStyle = (hovCluster?.count > 1 && !isHovStack) ? 'pointer' : (dragging ? 'grabbing' : 'grab');

  // Tooltip positioning — flip to left if near right edge
  const tooltipStyle = {
    left:  tooltipPos.x + 16 > containerW - 170 ? undefined : tooltipPos.x + 16,
    right: tooltipPos.x + 16 > containerW - 170 ? containerW - tooltipPos.x + 8 : undefined,
    top:   Math.max(0, tooltipPos.y - 12),
  };

  const globeCanvas = (
    <canvas
      ref={canvasRef}
      className="globe-canvas"
      style={{ cursor: cursorStyle, display: 'block' }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onMouseLeave={onMouseLeave}
    />
  );

  const tooltip = hovCluster && (
    <div className="globe-tooltip" style={tooltipStyle}>
      {hovHouse ? (
        <>
          <div className="globe-tt-name">{hovHouse.name}</div>
          <div className="globe-tt-city">{hovHouse.city}, {hovHouse.country}</div>
          <div className="globe-tt-coords">
            {Math.abs(hovHouse.lat).toFixed(4)}°&thinsp;{hovHouse.lat >= 0 ? 'N' : 'S'}
            &ensp;
            {Math.abs(hovHouse.lng).toFixed(4)}°&thinsp;{hovHouse.lng >= 0 ? 'E' : 'W'}
          </div>
          <div className="globe-tt-time">{localTime(hovHouse.tz, now)}</div>
        </>
      ) : isHovStack ? (
        <>
          <div className="globe-tt-name">{hovCluster.label}</div>
          <div className="globe-tt-time">{localTime(HOUSES[hovCluster.indices[0]].tz, now)}</div>
          {hovCluster.indices.map(idx => {
            const h = HOUSES[idx];
            return (
              <div key={idx} className="globe-tt-stack-row">
                <span className="globe-tt-stack-name">{h.name}</span>
                <span className="globe-tt-coords">
                  {Math.abs(h.lat).toFixed(4)}°&thinsp;{h.lat >= 0 ? 'N' : 'S'}
                  &ensp;
                  {Math.abs(h.lng).toFixed(4)}°&thinsp;{h.lng >= 0 ? 'E' : 'W'}
                </span>
              </div>
            );
          })}
        </>
      ) : (
        <>
          <div className="globe-tt-name">{hovCluster.label}</div>
          <div className="globe-tt-city">{hovCluster.count} design houses</div>
          {!isZoomed && <div className="globe-tt-coords">click to zoom in</div>}
        </>
      )}
    </div>
  );

  if (mini) {
    return (
      // Outer div: fixed MINI_SIZE, holds space — never moves or shifts layout
      <div style={{ position: 'relative', width: MINI_SIZE, height: MINI_SIZE, flexShrink: 0, marginTop: 10 }}>
        {/* Inner div: expands right→left + downward when zoomed */}
        <div
          ref={containerRef}
          style={{
            position: 'absolute',
            top: 0,
            right: 0,
            zIndex: isZoomed ? 200 : 1,
          }}
        >
          {globeCanvas}
          {!isZoomed && tooltip}
          {showBack && (
            <button className="globe-back-btn" onClick={handleBack}>← BACK</button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="globe-wrap" ref={containerRef}>
      {globeCanvas}
      {tooltip}
      {isZoomed && (
        <button className="globe-back-btn" onClick={handleBack}>← BACK</button>
      )}
    </div>
  );
}
