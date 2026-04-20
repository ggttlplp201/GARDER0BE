import { useState } from 'react';
import ImageUploadZone from './ImageUploadZone';
import { ITEM_TYPES } from '../lib/constants';

const DEFAULT_FIELDS = { name: '', color: '', brand: '', type: 'Shirt', size: '', price: '', urlInput: '' };

export default function AddItemModal({ open, onClose, onAdd }) {
  const [fields, setFields]   = useState(DEFAULT_FIELDS);
  const [pending, setPending] = useState([]);
  const [saving, setSaving]   = useState(false);

  function set(key, val) { setFields(f => ({ ...f, [key]: val })); }

  function handleTagApply(patches) {
    setFields(f => ({ ...f, ...patches }));
  }

  async function handleAdd() {
    if (!fields.name.trim()) return;
    setSaving(true);
    try { await onAdd(fields, pending); handleClose(); }
    catch (err) { alert('Error saving item: ' + err.message); }
    finally { setSaving(false); }
  }

  function handleClose() {
    setFields(DEFAULT_FIELDS);
    setPending([]);
    onClose();
  }

  function addUrlImg() {
    const url = fields.urlInput.trim(); if (!url) return;
    setPending(p => [...p, { src: url, blob: null, url }]);
    set('urlInput', '');
  }

  if (!open) return null;

  return (
    <div className="modal-bg open" onClick={e => { if (e.target === e.currentTarget) handleClose(); }}>
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
