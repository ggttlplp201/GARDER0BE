import { useState, useEffect, useRef } from 'react';
import { parseImageUrls, maybeConvertHeic, removeBg } from '../lib/imageUtils';
import { ITEM_TYPES } from '../lib/constants';
import BrandInput from './BrandInput';

export default function EditItemModal({ item, onClose, onSave }) {
  const [fields, setFields] = useState({ name: '', color: '', brand: '', type: 'Shirt', size: '', price: '', urlInput: '', status: 'owned', condition: '' });
  const [editImgs, setEditImgs] = useState([]);
  const [saving, setSaving]     = useState(false);
  const [error, setError]       = useState('');
  const [urlLoading, setUrlLoading] = useState(false);
  const blobUrlsRef = useRef([]);

  useEffect(() => {
    if (!item) return;
    const lastDash = (item.name || '').lastIndexOf(' - ');
    setFields({
      name:     lastDash >= 0 ? item.name.slice(0, lastDash) : (item.name || ''),
      color:    lastDash >= 0 ? item.name.slice(lastDash + 3) : '',
      brand:    item.brand || '',
      type:     item.type  || 'Shirt',
      size:     item.size  || '',
      price:    item.price || '',
      urlInput: '',
      status:          item.status          || 'owned',
      condition:       item.condition       || '',
    });
    setEditImgs(parseImageUrls(item.image_url).map(url => ({ src: url, blob: null, storedUrl: url })));
  }, [item]);

  function set(key, val) { setFields(f => ({ ...f, [key]: val })); }

  async function handleFileUpload(e) {
    const raws = Array.from(e.target.files); if (!raws.length) return;
    e.target.value = '';
    const newImgs = [];
    for (const raw of raws) {
      const file = await maybeConvertHeic(raw);
      const blob = await removeBg(file, raw.name);
      const src = URL.createObjectURL(blob);
      blobUrlsRef.current.push(src);
      newImgs.push({ src, blob, storedUrl: null });
    }
    setEditImgs(prev => [...prev, ...newImgs]);
  }

  async function addUrlImg() {
    const url = fields.urlInput.trim(); if (!url) return;
    set('urlInput', '');
    setUrlLoading(true);
    try {
      const resp = await fetch(url);
      const rawBlob = await resp.blob();
      const blob = await removeBg(new File([rawBlob], 'image.jpg', { type: rawBlob.type }));
      const src = URL.createObjectURL(blob);
      blobUrlsRef.current.push(src);
      setEditImgs(prev => [...prev, { src, blob, storedUrl: null }]);
    } catch {
      setEditImgs(prev => [...prev, { src: url, blob: null, storedUrl: null }]);
    } finally {
      setUrlLoading(false);
    }
  }

  function removeImg(idx) { setEditImgs(prev => prev.filter((_, i) => i !== idx)); }
  function moveImg(idx, dir) {
    const n = idx + dir;
    if (n < 0 || n >= editImgs.length) return;
    const next = [...editImgs];
    [next[idx], next[n]] = [next[n], next[idx]];
    setEditImgs(next);
  }

  async function handleSave() {
    if (!fields.name.trim()) return;
    setSaving(true); setError('');
    try { await onSave(fields, editImgs); onClose(); }
    catch (err) { setError(err.message || 'Failed to save changes.'); }
    finally { setSaving(false); }
  }

  useEffect(() => {
    const urls = blobUrlsRef.current;
    return () => { urls.forEach(url => URL.revokeObjectURL(url)); };
  }, []);

  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (!item) return null;

  return (
    <div className="modal-bg open" role="dialog" aria-modal="true" aria-label="Edit item" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal">
        <h2>EDIT ITEM</h2>
        <div className="field">
          <label>Item Name</label>
          <input value={fields.name} onChange={e => set('name', e.target.value)} autoFocus />
        </div>
        <div className="field">
          <label>Color</label>
          <input value={fields.color} onChange={e => set('color', e.target.value)} placeholder="e.g. Black" />
        </div>
        <div className="field">
          <label>Brand</label>
          <BrandInput value={fields.brand} onChange={v => set('brand', v)} />
        </div>
        <div className="field">
          <label>Type</label>
          <select value={fields.type} onChange={e => set('type', e.target.value)}>
            {ITEM_TYPES.map(t => <option key={t}>{t}</option>)}
          </select>
        </div>
        <div className="field">
          <label>Size</label>
          <input value={fields.size} onChange={e => set('size', e.target.value)} placeholder="e.g. M, L, 42" />
        </div>
        <div className="field">
          <label>Price ($)</label>
          <input type="number" min="0" value={fields.price} onChange={e => set('price', e.target.value)} placeholder="0" />
        </div>
        <div className="field">
          <label>Status</label>
          <select value={fields.status} onChange={e => set('status', e.target.value)}>
            <option value="owned">Owned</option>
            <option value="wishlist">Wishlist</option>
          </select>
        </div>
        <div className="field">
          <label>Condition</label>
          <select value={fields.condition} onChange={e => set('condition', e.target.value)}>
            <option value="">—</option>
            {['New','Excellent','Good','Fair','Poor'].map(c => <option key={c}>{c}</option>)}
          </select>
        </div>
        <div className="field">
          <label>Photos</label>
          {editImgs.length > 0 && (
            <div className="img-gallery" style={{ marginBottom: 10 }}>
              {editImgs.map((img, idx) => (
                <div key={idx} className="img-thumb">
                  <img src={img.src} alt="" />
                  <button className="img-thumb-x" onClick={() => removeImg(idx)}>×</button>
                  {editImgs.length > 1 && <>
                    <button className="img-thumb-move img-thumb-ml" onClick={() => moveImg(idx, -1)} style={idx === 0 ? { opacity: 0.3, pointerEvents: 'none' } : {}}>‹</button>
                    <button className="img-thumb-move img-thumb-mr" onClick={() => moveImg(idx, 1)} style={idx === editImgs.length-1 ? { opacity: 0.3, pointerEvents: 'none' } : {}}>›</button>
                  </>}
                </div>
              ))}
            </div>
          )}
          <div className="img-url-row" style={{ marginBottom: 6 }}>
            <label className="img-add-files">
              + ADD IMAGES
              <input type="file" accept="image/*,.heic,.heif" multiple onChange={handleFileUpload} style={{ display: 'none' }} />
            </label>
            <input
              className="img-url-input"
              value={fields.urlInput}
              onChange={e => set('urlInput', e.target.value)}
              placeholder="or paste URL"
              onKeyDown={e => e.key === 'Enter' && addUrlImg()}
            />
            <button className="img-url-add" onClick={addUrlImg} disabled={urlLoading}>
              {urlLoading ? '...' : 'ADD'}
            </button>
          </div>
          {urlLoading && <div className="url-processing">PROCESSING IMAGE...</div>}
        </div>
        {error && <div className="auth-error" style={{ marginBottom: 8 }}>{error}</div>}
        <div className="modal-actions">
          <button className="btn-cancel" onClick={onClose}>CANCEL</button>
          <button className="btn-add" onClick={handleSave} disabled={saving}>
            {saving ? 'SAVING...' : 'SAVE CHANGES'}
          </button>
        </div>
      </div>
    </div>
  );
}
