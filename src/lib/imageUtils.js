import { API_URL, STORAGE } from './constants';
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
    const heic2any = (await import('heic2any')).default;
    const result = await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.92 });
    return Array.isArray(result) ? result[0] : result;
  } catch {
    return file;
  }
}

export async function removeBg(file, rawName) {
  if (!API_URL) return file; // no backend configured — skip silently
  try {
    const fd = new FormData();
    fd.append('file', file, rawName);
    const res = await fetch(`${API_URL}/remove-bg`, { method: 'POST', body: fd });
    if (res.ok) return await res.blob();
  } catch {}
  return file;
}

export async function autoTagWithClaude(blob) {
  if (API_URL) {
    const fd = new FormData();
    fd.append('file', blob, 'item.jpg');
    const resp = await fetch(`${API_URL}/tag`, { method: 'POST', body: fd });
    if (!resp.ok) throw new Error(await readApiError(resp, 'AI tagging failed'));
    return await resp.json();
  }

  const base64 = await new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result.split(',')[1]);
    r.onerror = rej;
    r.readAsDataURL(blob);
  });
  const mediaType = blob.type === 'image/png' ? 'image/png' : 'image/jpeg';

  // Use Supabase JS client to avoid CORS issues
  const { data, error } = await sb.functions.invoke('claude-tag', {
    body: { base64, mediaType },
  });
  if (error) throw new Error(error.message);
  const raw = data?.content?.[0]?.text?.trim() || '';
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('no JSON in response');
  return JSON.parse(match[0]);
}

async function readApiError(response, fallback) {
  const text = await response.text();
  try {
    const data = JSON.parse(text);
    return data.detail || fallback;
  } catch {
    return text || fallback;
  }
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
