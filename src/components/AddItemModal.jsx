import { useState, useEffect, useRef } from 'react';
import ImageUploadZone from './ImageUploadZone';
import BrandInput from './BrandInput';
import { ITEM_TYPES } from '../lib/constants';
import { removeBg } from '../lib/imageUtils';

const DEFAULT_FIELDS = { name: '', color: '', brand: '', type: 'Shirt', size: '', price: '', urlInput: '', status: 'owned', condition: '' };

export default function AddItemModal({ open, onClose, onAdd }) {
  const [fields, setFields]   = useState(DEFAULT_FIELDS);
  const [pending, setPending] = useState([]);
  const [saving, setSaving]     = useState(false);
  const [error, setError]       = useState('');
  const [urlLoading, setUrlLoading] = useState(false);

  function set(key, val) { setFields(f => ({ ...f, [key]: val })); }

  function handleTagApply(patches) {
    setFields(f => ({ ...f, ...patches }));
  }

  async function handleAdd() {
    if (!fields.name.trim()) { setError('Please enter an item name.'); return; }
    setSaving(true); setError('');
    try { await onAdd(fields, pending); handleClose(); }
    catch (err) { setError(err.message || 'Failed to save item.'); }
    finally { setSaving(false); }
  }

  function handleClose() {
    setFields(DEFAULT_FIELDS);
    setPending([]);
    setError('');
    onClose();
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
      setPending(p => [...p, { src, blob, url: null }]);
    } catch {
      setPending(p => [...p, { src: url, blob: null, url }]);
    } finally {
      setUrlLoading(false);
    }
  }

  const modalRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onKey = e => { if (e.key === 'Escape') handleClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!open) return null;

  return (
    <div className="modal-bg open" role="dialog" aria-modal="true" aria-label="Add new item" ref={modalRef} onClick={e => { if (e.target === e.currentTarget) handleClose(); }}>
      <div className="modal">
        <h2>ADD NEW ITEM</h2>
        <div className="field">
          <label>Item Name</label>
          <input value={fields.name} onChange={e => set('name', e.target.value)} placeholder="e.g. Logo Crewneck" autoFocus />
        </div>
        <div className="field">
          <label>Color</label>
          <input value={fields.color} onChange={e => set('color', e.target.value)} placeholder="e.g. Black, Ecru, Washed Grey" />
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
        <ImageUploadZone
          pending={pending}
          onChange={setPending}
          fields={fields}
          onTagApply={handleTagApply}
          isFirstUpload={pending.length === 0}
        />

        <div className="img-url-row" style={{ marginTop: 6 }}>
          <input
            className="img-url-input"
            value={fields.urlInput}
            onChange={e => set('urlInput', e.target.value)}
            placeholder="or paste image URL"
            onKeyDown={e => e.key === 'Enter' && addUrlImg()}
          />
          <button className="img-url-add" onClick={addUrlImg} disabled={urlLoading}>
            {urlLoading ? '...' : 'ADD'}
          </button>
        </div>
        {urlLoading && <div className="url-processing">PROCESSING IMAGE...</div>}

        {error && <div className="auth-error" style={{ marginBottom: 8 }}>{error}</div>}
        <div className="modal-actions">
          <button className="btn-cancel" onClick={handleClose}>CANCEL</button>
          <button className="btn-add" onClick={handleAdd} disabled={saving}>
            {saving ? 'SAVING...' : 'ADD TO COLLECTION'}
          </button>
        </div>
      </div>
    </div>
  );
}
