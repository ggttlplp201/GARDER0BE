import heic2any from 'heic2any';
import { API_URL, REMOVE_BG_API_KEY, SUPABASE_ANON_KEY, CLAUDE_TAG_URL, STORAGE } from './constants';
import { sb } from './supabase';

export function parseImageUrls(raw) {
  if (!raw) return [];
  try { const p = JSON.parse(raw); if (Array.isArray(p)) return p; } catch {}
  return [raw];
}

export async function maybeConvertHeic(file) {
  const isHeic = file.type === 'image/heic' || file.type === 'image/heif' ||
                 /\.(heic|heif)$/i.test(file.name);
  if (!isHeic) return file;
  try {
    const result = await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.92 });
    return Array.isArray(result) ? result[0] : result;
  } catch {
    return file;
  }
}

export async function removeBg(file, rawName) {
  try {
    const fd = new FormData();
    fd.append('file', file, rawName);
    if (API_URL) {
      const res = await fetch(`${API_URL}/remove-bg`, { method: 'POST', body: fd });
      if (res.ok) return await res.blob();
    } else {
      // fallback: call remove.bg directly from browser
      fd.append('size', 'auto');
      const res = await fetch('https://api.remove.bg/v1.0/removebg', {
        method: 'POST', headers: { 'X-Api-Key': REMOVE_BG_API_KEY }, body: fd,
      });
      if (res.ok) return await res.blob();
    }
  } catch {}
  return file;
}

export async function autoTagWithClaude(blob) {
  if (API_URL) {
    const fd = new FormData();
    fd.append('file', blob, 'item.jpg');
    const resp = await fetch(`${API_URL}/tag`, { method: 'POST', body: fd });
    if (!resp.ok) throw new Error(await resp.text());
    return await resp.json();
  }

  // fallback: call Supabase Edge Function directly
  const base64 = await new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result.split(',')[1]);
    r.onerror = rej;
    r.readAsDataURL(blob);
  });
  const mediaType = blob.type === 'image/png' ? 'image/png' : 'image/jpeg';
  const resp = await fetch(CLAUDE_TAG_URL, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ base64, mediaType }),
  });
  if (!resp.ok) throw new Error(await resp.text());
  const data = await resp.json();
  const raw = data.content?.[0]?.text?.trim() || '';
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('no JSON');
  return JSON.parse(match[0]);
}

const blank = v => !v || /^(unknown|n\/a|none|unidentified|not visible|unclear|-)$/i.test(v.trim());

export function applyTags(tags, fields) {
  const out = {};
  if (!blank(tags.name)  && !fields.name)  out.name  = tags.name;
  if (!blank(tags.brand) && !fields.brand) out.brand = tags.brand;
  if (!blank(tags.color) && !fields.color) out.color = tags.color;
  if (tags.type) out.type = tags.type;
  return out;
}

export async function uploadImageBlob(blob) {
  const ext  = blob.type === 'image/png' ? 'png' : 'jpg';
  const path = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
  const { error } = await sb.storage.from('images').upload(path, blob, { contentType: blob.type });
  if (error) throw new Error(error.message);
  return `${STORAGE}/images/${path}`;
}

export async function deleteStorageUrl(url) {
  if (!url.startsWith(`${STORAGE}/images/`)) return;
  const p = decodeURIComponent(url.replace(`${STORAGE}/images/`, '').split('?')[0]);
  await sb.storage.from('images').remove([p]);
}
