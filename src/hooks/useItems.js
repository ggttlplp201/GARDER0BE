import { useState, useCallback, useRef } from 'react';
import { sb } from '../lib/supabase';
import { parseImageUrls, uploadImageBlob, deleteStorageUrl } from '../lib/imageUtils';

export function useItems(user) {
  const [items, setItems]         = useState([]);
  const [loading, setLoading]     = useState(false);
  const [loadError, setLoadError] = useState(false);
  const fetchGenRef               = useRef(0);

  const fetchItems = useCallback(async () => {
    if (!user) return;
    const gen = ++fetchGenRef.current;
    setLoading(true);
    setLoadError(false);

    let { data, error } = await sb.from('items').select('*').eq('user_id', user.id).order('created_at', { ascending: true });

    // One automatic retry after 900 ms on transient failure
    if (error) {
      await new Promise(r => setTimeout(r, 900));
      ({ data, error } = await sb.from('items').select('*').eq('user_id', user.id).order('created_at', { ascending: true }));
    }

    // Discard stale responses if a newer fetch has started
    if (gen !== fetchGenRef.current) return;

    setLoading(false);
    if (error) { console.error(error); setLoadError(true); return; }
    setItems(data);
    try {
      const urls = data.map(it => parseImageUrls(it.image_url)[0]).filter(Boolean);
      if (urls.length) localStorage.setItem('garderobe-preview-imgs', JSON.stringify(urls));
    } catch {}
  }, [user]);

  async function addItem(fields, pendingImgs) {
    const color    = fields.color?.trim();
    const fullName = color ? `${fields.name} - ${color}` : fields.name;
    let image_url  = null;

    if (pendingImgs.length) {
      const urls = [];
      for (const item of pendingImgs) {
        if (item.blob) urls.push(await uploadImageBlob(item.blob));
        else if (item.url) urls.push(item.url);
      }
      image_url = urls.length === 1 ? urls[0] : JSON.stringify(urls);
    }

    const { error } = await sb.from('items').insert({
      name: fullName, brand: fields.brand, type: fields.type,
      size: fields.size, price: parseFloat(fields.price) || 0,
      image_url, user_id: user.id,
      status: fields.status || 'owned',
      condition: fields.condition || null,
    });
    if (error) throw new Error(error.message);
    await fetchItems();
  }

  async function editItem(id, fields, editImgs, originalItem) {
    const color    = fields.color?.trim();
    const fullName = color ? `${fields.name} - ${color}` : fields.name;

    // Delete removed stored images
    const originalUrls = parseImageUrls(originalItem?.image_url);
    const kept = new Set(editImgs.filter(i => i.storedUrl).map(i => i.storedUrl));
    for (const url of originalUrls) {
      if (!kept.has(url)) await deleteStorageUrl(url);
    }

    // Build final URL list
    const finalUrls = [];
    for (const item of editImgs) {
      if (item.blob)       finalUrls.push(await uploadImageBlob(item.blob));
      else if (item.storedUrl) finalUrls.push(item.storedUrl);
      else if (item.src)   finalUrls.push(item.src);
    }
    const image_url = finalUrls.length === 0 ? null
      : finalUrls.length === 1 ? finalUrls[0]
      : JSON.stringify(finalUrls);

    const { error } = await sb.from('items').update({
      name: fullName, brand: fields.brand, type: fields.type,
      size: fields.size, price: parseFloat(fields.price) || 0, image_url,
      status: fields.status || 'owned',
      condition: fields.condition || null,
    }).eq('id', id);
    if (error) throw new Error(error.message);
    await fetchItems();
  }

  async function removeItem(id) {
    const item = items.find(i => i.id === id);
    await sb.from('items').delete().eq('id', id);
    const urls = parseImageUrls(item?.image_url);
    for (const url of urls) await deleteStorageUrl(url);
    await fetchItems();
  }

  async function logWear(id) {
    const item = items.find(i => i.id === id);
    if (!item) return;
    const next = (item.wear_count || 0) + 1;
    setItems(prev => prev.map(i => i.id === id ? { ...i, wear_count: next } : i));
    await sb.from('items').update({ wear_count: next }).eq('id', id);
  }

  return { items, loading, loadError, fetchItems, addItem, editItem, removeItem, logWear };
}
