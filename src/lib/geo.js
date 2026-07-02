// geo.js — dynamic location + timezone detection
//
// Detection order:
//   1. IP geolocation (ipwho.is — free, keyless, CORS-enabled): city + coords + tz
//   2. Fallback: IANA timezone from the browser (always available, no permission),
//      city approximated from the timezone name (e.g. Europe/Berlin → Berlin)
//
// The result is cached in sessionStorage so the network call happens at most
// once per browser session.

const CACHE_KEY = 'garderobe-geo';

export function detectTimezone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}

// "America/Los_Angeles" → "Los Angeles"
export function tzToCity(tz) {
  if (!tz || !tz.includes('/')) return null;
  const city = tz.split('/').pop().replace(/_/g, ' ');
  return city || null;
}

// Short timezone label for the current locale, e.g. "PST", "CEST", "GMT+2"
export function tzAbbrev(tz, date = new Date()) {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz || undefined,
      timeZoneName: 'short',
    }).formatToParts(date);
    return parts.find(p => p.type === 'timeZoneName')?.value || '';
  } catch {
    return '';
  }
}

export function cachedGeo() {
  try {
    const raw = sessionStorage.getItem(CACHE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

// Resolves to { city, timezone, latitude, longitude, source } — never rejects.
// latitude/longitude are null when only the timezone fallback is available.
export async function detectGeo() {
  const cached = cachedGeo();
  if (cached) return cached;

  const timezone = detectTimezone();
  let geo = {
    city: tzToCity(timezone),
    timezone,
    latitude: null,
    longitude: null,
    source: 'timezone',
  };

  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 5000);
    const res = await fetch('https://ipwho.is/', { signal: ctrl.signal });
    clearTimeout(timer);
    if (res.ok) {
      const data = await res.json();
      if (data?.success && data.city &&
          Number.isFinite(data.latitude) && Number.isFinite(data.longitude)) {
        geo = {
          city: data.city,
          timezone: data.timezone?.id || timezone,
          latitude: data.latitude,
          longitude: data.longitude,
          source: 'ip',
        };
      }
    }
  } catch {
    // Offline / blocked / timed out — timezone fallback already in place
  }

  try { sessionStorage.setItem(CACHE_KEY, JSON.stringify(geo)); } catch { /* ignore */ }
  return geo;
}
