import { useRef, useEffect, useState, useCallback } from 'react';
import { geoOrthographic, geoPath, geoGraticule } from 'd3-geo';
import { feature } from 'topojson-client';
import worldData from 'world-atlas/countries-110m.json';
import { sb } from '../lib/supabase';

const INIT_ROTY  = -0.18;
const INIT_ROTX  =  0.50;
const IDLE_SPEED =  0.004;
const FRICTION   =  0.88;
const ROTX_MIN   = -1.3;
const ROTX_MAX   =  1.3;
const PIN_R      =  4.5;
const CLUSTER_R  = 11;
const CLUSTER_D      = PIN_R * 2.6;
const GEO_STACK_DEG  = 0.015;
const MINI_SIZE  = 218;  // px — collapsed size in header-right
const ZOOM_SIZE  = 380;  // px — expanded size when zoomed in mini mode
const ZOOM_CLIP  = 28;   // fixed clip angle (°) for all zoom-ins

const LAND      = (() => { try { return feature(worldData, worldData.objects.land); } catch { return null; } })();
const GRATICULE = geoGraticule().step([30, 30])();

// City → coordinates lookup for geocoding free-text profile locations
const CITY_COORDS = {
  'paris':         { lat: 48.8566, lng:   2.3522, country: 'France',       tz: 'Europe/Paris'      },
  'milan':         { lat: 45.4642, lng:   9.1900, country: 'Italy',        tz: 'Europe/Rome'       },
  'london':        { lat: 51.5074, lng:  -0.1278, country: 'UK',           tz: 'Europe/London'     },
  'new york':      { lat: 40.7128, lng: -74.0060, country: 'USA',          tz: 'America/New_York'  },
  'nyc':           { lat: 40.7128, lng: -74.0060, country: 'USA',          tz: 'America/New_York'  },
  'tokyo':         { lat: 35.6762, lng: 139.6503, country: 'Japan',        tz: 'Asia/Tokyo'        },
  'los angeles':   { lat: 34.0522, lng:-118.2437, country: 'USA',          tz: 'America/Los_Angeles'},
  'la':            { lat: 34.0522, lng:-118.2437, country: 'USA',          tz: 'America/Los_Angeles'},
  'seoul':         { lat: 37.5665, lng: 126.9780, country: 'South Korea',  tz: 'Asia/Seoul'        },
  'sydney':        { lat:-33.8688, lng: 151.2093, country: 'Australia',    tz: 'Australia/Sydney'  },
  'berlin':        { lat: 52.5200, lng:  13.4050, country: 'Germany',      tz: 'Europe/Berlin'     },
  'amsterdam':     { lat: 52.3676, lng:   4.9041, country: 'Netherlands',  tz: 'Europe/Amsterdam'  },
  'copenhagen':    { lat: 55.6761, lng:  12.5683, country: 'Denmark',      tz: 'Europe/Copenhagen' },
  'stockholm':     { lat: 59.3293, lng:  18.0686, country: 'Sweden',       tz: 'Europe/Stockholm'  },
  'miami':         { lat: 25.7617, lng: -80.1918, country: 'USA',          tz: 'America/New_York'  },
  'chicago':       { lat: 41.8781, lng: -87.6298, country: 'USA',          tz: 'America/Chicago'   },
  'dubai':         { lat: 25.2048, lng:  55.2708, country: 'UAE',          tz: 'Asia/Dubai'        },
  'singapore':     { lat:  1.3521, lng: 103.8198, country: 'Singapore',    tz: 'Asia/Singapore'    },
  'hong kong':     { lat: 22.3193, lng: 114.1694, country: 'Hong Kong',    tz: 'Asia/Hong_Kong'    },
  'shanghai':      { lat: 31.2304, lng: 121.4737, country: 'China',        tz: 'Asia/Shanghai'     },
  'beijing':       { lat: 39.9042, lng: 116.4074, country: 'China',        tz: 'Asia/Shanghai'     },
  'rome':          { lat: 41.9028, lng:  12.4964, country: 'Italy',        tz: 'Europe/Rome'       },
  'florence':      { lat: 43.7696, lng:  11.2558, country: 'Italy',        tz: 'Europe/Rome'       },
  'barcelona':     { lat: 41.3851, lng:   2.1734, country: 'Spain',        tz: 'Europe/Madrid'     },
  'madrid':        { lat: 40.4168, lng:  -3.7038, country: 'Spain',        tz: 'Europe/Madrid'     },
  'osaka':         { lat: 34.6937, lng: 135.5023, country: 'Japan',        tz: 'Asia/Tokyo'        },
  'toronto':       { lat: 43.6532, lng: -79.3832, country: 'Canada',       tz: 'America/Toronto'   },
  'montreal':      { lat: 45.5017, lng: -73.5673, country: 'Canada',       tz: 'America/Toronto'   },
  'vancouver':     { lat: 49.2827, lng:-123.1207, country: 'Canada',       tz: 'America/Vancouver' },
  'mexico city':   { lat: 19.4326, lng: -99.1332, country: 'Mexico',       tz: 'America/Mexico_City'},
  'moscow':        { lat: 55.7558, lng:  37.6176, country: 'Russia',       tz: 'Europe/Moscow'     },
  'istanbul':      { lat: 41.0082, lng:  28.9784, country: 'Turkey',       tz: 'Europe/Istanbul'   },
  'zurich':        { lat: 47.3769, lng:   8.5417, country: 'Switzerland',  tz: 'Europe/Zurich'     },
  'vienna':        { lat: 48.2082, lng:  16.3738, country: 'Austria',      tz: 'Europe/Vienna'     },
  'brussels':      { lat: 50.8503, lng:   4.3517, country: 'Belgium',      tz: 'Europe/Brussels'   },
  'lisbon':        { lat: 38.7223, lng:  -9.1393, country: 'Portugal',     tz: 'Europe/Lisbon'     },
  'warsaw':        { lat: 52.2297, lng:  21.0122, country: 'Poland',       tz: 'Europe/Warsaw'     },
  'san francisco': { lat: 37.7749, lng:-122.4194, country: 'USA',          tz: 'America/Los_Angeles'},
  'sf':            { lat: 37.7749, lng:-122.4194, country: 'USA',          tz: 'America/Los_Angeles'},
  'irvine':        { lat: 33.6846, lng:-117.8265, country: 'USA',          tz: 'America/Los_Angeles'},
  'seattle':       { lat: 47.6062, lng:-122.3321, country: 'USA',          tz: 'America/Los_Angeles'},
  'boston':        { lat: 42.3601, lng: -71.0589, country: 'USA',          tz: 'America/New_York'  },
  'atlanta':       { lat: 33.7490, lng: -84.3880, country: 'USA',          tz: 'America/New_York'  },
  'las vegas':     { lat: 36.1699, lng:-115.1398, country: 'USA',          tz: 'America/Los_Angeles'},
  'denver':        { lat: 39.7392, lng:-104.9903, country: 'USA',          tz: 'America/Denver'    },
  'delhi':         { lat: 28.6139, lng:  77.2090, country: 'India',        tz: 'Asia/Kolkata'      },
  'mumbai':        { lat: 19.0760, lng:  72.8777, country: 'India',        tz: 'Asia/Kolkata'      },
  'bangkok':       { lat: 13.7563, lng: 100.5018, country: 'Thailand',     tz: 'Asia/Bangkok'      },
  'taipei':        { lat: 25.0330, lng: 121.5654, country: 'Taiwan',       tz: 'Asia/Taipei'       },
  'johannesburg':  { lat:-26.2041, lng:  28.0473, country: 'South Africa', tz: 'Africa/Johannesburg'},
  'lagos':         { lat:  6.5244, lng:   3.3792, country: 'Nigeria',      tz: 'Africa/Lagos'      },
  'nairobi':       { lat: -1.2921, lng:  36.8219, country: 'Kenya',        tz: 'Africa/Nairobi'    },
};

function geocodeLocation(locationStr) {
  if (!locationStr) return null;
  const lower = locationStr.toLowerCase().trim();
  if (CITY_COORDS[lower]) return { city: locationStr, ...CITY_COORDS[lower] };
  for (const [key, coords] of Object.entries(CITY_COORDS)) {
    if (lower.includes(key)) return { city: key.charAt(0).toUpperCase() + key.slice(1), ...coords };
  }
  return null;
}

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

function buildZoomedClusters(visible, houses) {
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
    const h0  = houses[visible[group[0]].i];
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

export default function DesignHouseGlobe({ mini = false, onViewProfile }) {
  const housesRef    = useRef([]); // populated from other users' profiles
  const friendIdsRef = useRef(new Set()); // IDs of accepted friends
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
  const labBoxesRef   = useRef([]); // [{bx,by,bw,bh,houseIdx}] — zoomed label hit areas

  const [dragging, setDragging]     = useState(false);
  const [isZoomed, setIsZoomed]     = useState(false);
  const [showBack, setShowBack]     = useState(false);
  const isZoomedRef                 = useRef(false);

  // Tick local time every minute (drives canvas label times via nowRef)
  useEffect(() => {
    const t = setInterval(() => { nowRef.current = new Date(); }, 60000);
    return () => clearInterval(t);
  }, []);

  // Fetch all profiles with locations + track which are friends
  useEffect(() => {
    async function loadProfiles() {
      const { data: { session } } = await sb.auth.getSession();
      if (!session?.user) return;
      const uid = session.user.id;

      // Get accepted friend IDs (either direction)
      const { data: reqs } = await sb.from('friend_requests')
        .select('from_user_id, to_user_id')
        .eq('status', 'accepted')
        .or(`from_user_id.eq.${uid},to_user_id.eq.${uid}`);
      const friendIds = new Set(
        (reqs || []).map(r => r.from_user_id === uid ? r.to_user_id : r.from_user_id)
      );
      friendIdsRef.current = friendIds;

      // Load all profiles that have a location set (future: filter is_public=true)
      const { data: profiles } = await sb.from('profiles')
        .select('id, username, location, avatar_url')
        .neq('id', uid)
        .not('location', 'is', null);
      if (!profiles?.length) return;

      const pins = [];
      profiles.forEach(p => {
        if (!p.location?.trim()) return;
        const geo = geocodeLocation(p.location);
        if (!geo) return;
        const jitter = () => (Math.random() - 0.5) * 0.008;
        pins.push({
          id:        p.id,
          name:      p.username || 'Member',
          city:      geo.city,
          country:   geo.country,
          lat:       geo.lat + jitter(),
          lng:       geo.lng + jitter(),
          tz:        geo.tz,
          isFriend:  friendIds.has(p.id),
          profile:   p,
        });
      });
      housesRef.current = pins;
      labelCacheRef.current = { key: '', measured: [] };
    }
    loadProfiles();
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
    const { night } = solarCacheRef.current;
    ctx.beginPath(); path(night);
    ctx.fillStyle = isDark ? 'rgba(0,0,0,0.28)' : 'rgba(0,0,0,0.07)';
    ctx.fill();

    if (!isMini) {
      ctx.beginPath(); path(GRATICULE);
      ctx.strokeStyle = isDark ? 'rgba(232,232,232,0.12)' : 'rgba(0,0,0,0.10)';
      ctx.lineWidth = 0.7; ctx.stroke();
    }

    ctx.beginPath(); path(night);
    ctx.strokeStyle = isDark ? 'rgba(232,232,232,0.18)' : 'rgba(0,0,0,0.14)';
    ctx.lineWidth = 0.8; ctx.stroke();

    const houses = housesRef.current;

    // City lights in dark mode — glowing dots at friend locations
    if (isDark) {
      for (let i = 0; i < houses.length; i++) {
        const h = houses[i];
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
      _atmos.addColorStop(1, isDark ? 'rgba(120,160,255,0.10)' : 'rgba(100,140,255,0.07)');
      const _hlx = cx - r * 0.28, _hly = cy - r * 0.30;
      const _hl = ctx.createRadialGradient(_hlx, _hly, 0, _hlx, _hly, r * 0.52);
      _hl.addColorStop(0, isDark ? 'rgba(255,255,255,0.09)' : 'rgba(255,255,255,0.14)');
      _hl.addColorStop(1, 'transparent');
      const _dark = ctx.createRadialGradient(cx + r * 0.20, cy + r * 0.20, r * 0.45, cx, cy, r);
      _dark.addColorStop(0, 'transparent');
      _dark.addColorStop(1, isDark ? 'rgba(0,0,0,0.18)' : 'rgba(0,0,0,0.10)');
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
    for (let i = 0; i < houses.length; i++) {
      const pos = proj([houses[i].lng, houses[i].lat]);
      if (!pos) continue;
      const [sx, sy] = pos;
      if (Math.hypot(sx - cx, sy - cy) > r - 2) continue;
      visible.push({ i, sx, sy, lat: houses[i].lat, lng: houses[i].lng, city: houses[i].city });
    }
    const clusters = isZoomedRef.current ? buildZoomedClusters(visible, houses) : buildClusters(visible);
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
          const h0 = houses[indices[0]];
          const textLines = [];
          if (isStack && count > 1) {
            for (const idx of indices) textLines.push({ text: houses[idx].name, bold: true, sz: 8, friendBadge: houses[idx].isFriend });
            textLines.push({ text: `${h0.city} · ${localTime(h0.tz, nowT)}`, bold: false, sz: 7, dim: true });
          } else {
            textLines.push({ text: h0.name, bold: true, sz: 8, friendBadge: h0.isFriend });
            textLines.push({ text: `${h0.city} · ${localTime(h0.tz, nowT)}`, bold: false, sz: 7, dim: true });
          }
          let maxW = 0;
          for (const l of textLines) {
            ctx.font = `${l.bold ? 'bold ' : ''}${l.sz}px Arial`;
            let lw = ctx.measureText(l.text).width;
            if (l.friendBadge) { ctx.font = `${l.sz - 1}px Arial`; lw += 5 + ctx.measureText('FRIENDS').width; }
            maxW = Math.max(maxW, lw);
          }
          return { textLines, bw: maxW + padX * 2, bh: textLines.length * lineH + padY * 2 };
        });
        labelCacheRef.current = { key: _labKey, measured: _measured };
      }
      const { measured } = labelCacheRef.current;

      // For cities with multiple visible clusters, force vertical direction by longitude:
      // westernmost cluster → label below dot (uy=+1), easternmost → label above dot (uy=-1).
      // This keeps paired clusters (e.g. the two Paris groups) visually balanced.
      const _cityMap = new Map();
      clusters.forEach((cl, ci) => {
        const city = houses[cl.indices[0]].city;
        if (!_cityMap.has(city)) _cityMap.set(city, []);
        _cityMap.get(city).push(ci);
      });
      const _forcedUy = new Array(clusters.length).fill(null);
      _cityMap.forEach(cis => {
        if (cis.length < 2) return;
        const sorted = [...cis].sort((a, b) => {
          const avgLng = ci => clusters[ci].indices.reduce((s, i) => s + houses[i].lng, 0) / clusters[ci].indices.length;
          return avgLng(a) - avgLng(b);
        });
        sorted.forEach((ci, rank) => { _forcedUy[ci] = rank === 0 ? 1 : -1; });
      });

      // Build per-frame lab positions from current cluster screen coordinates + cached measurements
      const labs = clusters.map((cl, ci) => {
        const { sx, sy } = cl;
        const { bw, bh, textLines } = measured[ci];
        const dx = sx - cx, dy = sy - cy;
        const dist = Math.hypot(dx, dy) || 1;
        const ux = dist < 10 ? 0 : dx / dist;
        const uy = _forcedUy[ci] !== null ? _forcedUy[ci] : (dist < 10 ? -1 : dy / dist);
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

      // Store label bounding boxes for click detection
      labBoxesRef.current = labs.map((lab, ci) => ({
        bx: lab.bx, by: lab.by, bw: lab.bw, bh: lab.bh,
        houseIdx: clusters[ci]?.indices[0] ?? null,
      }));

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
          if (l.friendBadge) {
            const nw = ctx.measureText(l.text).width;
            ctx.font = `${l.sz - 1}px Arial`;
            ctx.fillStyle = isDark ? '#888' : '#aaa';
            ctx.fillText('FRIENDS', bx + padX + nw + 5, by + padY + i * lineH);
          }
        });
      }
    }

    if (!isZoomedRef.current) labBoxesRef.current = [];

    ctx.restore();
  }, []);

  // Animation loop — full 60fps during interaction, ~20fps when idle
  useEffect(() => {
    function frame(ts) {
      if (pausedRef.current) { animRef.current = requestAnimationFrame(frame); return; }
      const isActive = dragRef.current || flyRef.current;
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
    }
    // Pointer cursor when hovering a zoomed label box
    if (canvasRef.current && isZoomedRef.current && onViewProfile) {
      const overLabel = labBoxesRef.current.some(lb =>
        mx >= lb.bx && mx <= lb.bx + lb.bw && my >= lb.by && my <= lb.by + lb.bh
      );
      canvasRef.current.style.cursor = overLabel ? 'pointer' : 'grab';
    }
  }, [hitCluster, onViewProfile]);

  const onPointerUp = useCallback((e) => {
    if (dragRef.current && !dragRef.current.moved) {
      const canvas = canvasRef.current;
      const rect   = canvas?.getBoundingClientRect();
      if (rect) {
        const mx = e.clientX - rect.left, my = e.clientY - rect.top;

        // Click on a zoomed label box → navigate to profile
        if (isZoomedRef.current && onViewProfile) {
          for (const lb of labBoxesRef.current) {
            if (mx >= lb.bx && mx <= lb.bx + lb.bw && my >= lb.by && my <= lb.by + lb.bh) {
              const house = housesRef.current[lb.houseIdx];
              if (house?.profile) { onViewProfile(house.profile); dragRef.current = null; setDragging(false); return; }
            }
          }
        }

        const ci = hitCluster(mx, my);
        if (ci !== null && !isZoomedRef.current) {
          const cl = clustersRef.current[ci];
          flyRef.current = {
            tRotY: -cl.lng * Math.PI / 180,
            tRotX:  cl.lat * Math.PI / 180,
            tClip: ZOOM_CLIP,
            tSize: ZOOM_SIZE,
          };
          isZoomedRef.current = true;
          hovIdxRef.current = null;
          setShowBack(true);
        }
      }
    }
    dragRef.current = null;
    setDragging(false);
  }, [hitCluster]);

  const onMouseLeave = useCallback(() => {
    hovIdxRef.current = null;
    setDragging(false);
  }, []);

  const handleBack = useCallback(() => {
    flyRef.current = { tRotY: rotYRef.current, tRotX: rotXRef.current, tClip: 90, tSize: MINI_SIZE };
    isZoomedRef.current = false;
    setIsZoomed(false);
    setShowBack(false);
  }, []);

  const cursorStyle = dragging ? 'grabbing' : 'grab';

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
      {isZoomed && (
        <button className="globe-back-btn" onClick={handleBack}>← BACK</button>
      )}
    </div>
  );
}
