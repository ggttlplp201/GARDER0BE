import { useState, useEffect, useRef } from 'react';
import ImageUploadZone from './ImageUploadZone';
import { ITEM_TYPES } from '../lib/constants';

const DEFAULT_FIELDS = { name: '', color: '', brand: '', type: 'Shirt', size: '', price: '', urlInput: '', status: 'owned', condition: '', purchase_date: '', retail_price: '', notes: '', resale_estimate: '', tags: '' };

export default function AddItemModal({ open, onClose, onAdd }) {
  const [fields, setFields]   = useState(DEFAULT_FIELDS);
  const [pending, setPending] = useState([]);
  const [saving, setSaving]   = useState(false);
  const [error, setError]     = useState('');

  function set(key, val) { setFields(f => ({ ...f, [key]: val })); }

  function handleTagApply(patches) {
    setFields(f => ({ ...f, ...patches }));
  }

  async function handleAdd() {
    if (!fields.name.trim()) return;
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

  function addUrlImg() {
    const url = fields.urlInput.trim(); if (!url) return;
    setPending(p => [...p, { src: url, blob: null, url }]);
    set('urlInput', '');
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
          <input value={fields.brand} onChange={e => set('brand', e.target.value)} placeholder="e.g. Acne Studios" />
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
          <label>Purchase Price ($)</label>
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
          <label>Purchase Date</label>
          <input type="date" value={fields.purchase_date} onChange={e => set('purchase_date', e.target.value)} />
        </div>
        <div className="field">
          <label>Retail Price ($)</label>
          <input type="number" min="0" value={fields.retail_price} onChange={e => set('retail_price', e.target.value)} placeholder="Original retail" />
        </div>
        <div className="field">
          <label>Resale Estimate ($)</label>
          <input type="number" min="0" value={fields.resale_estimate} onChange={e => set('resale_estimate', e.target.value)} placeholder="Current market value" />
        </div>
        <div className="field">
          <label>Tags</label>
          <input value={fields.tags} onChange={e => set('tags', e.target.value)} placeholder="e.g. streetwear, archive, grail" />
        </div>
        <div className="field">
          <label>Notes</label>
          <textarea rows="2" style={{ width: '100%', padding: '7px 10px', border: '1.5px solid black', fontFamily: 'Arial, sans-serif', fontSize: 13, resize: 'none' }} value={fields.notes} onChange={e => set('notes', e.target.value)} placeholder="Provenance, condition notes, etc." />
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
          <button className="img-url-add" onClick={addUrlImg}>ADD</button>
        </div>

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
