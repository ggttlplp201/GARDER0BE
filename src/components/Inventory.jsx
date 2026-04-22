import { useState, useEffect } from 'react';

const RECENT_CUTOFF = Date.now() - 30 * 24 * 60 * 60 * 1000;
import ItemCard from './ItemCard';
import MusicPlayer from './MusicPlayer';
import ProfilePanel from './ProfilePanel';
import Lightbox from './Lightbox';
import AddItemModal from './AddItemModal';
import EditItemModal from './EditItemModal';
import { useItems } from '../hooks/useItems';
import { ITEM_TYPES } from '../lib/constants';
import { usePlayer } from '../hooks/usePlayer';

const SORT_OPTIONS = [
  { value: 'brand', label: 'Brand' },
  { value: 'date',  label: 'Date Added' },
  { value: 'type',  label: 'Type' },
  { value: 'price', label: 'Price' },
];

const PRICE_ORDER = ['$1000+','$750–$999','$500–$749','$200–$499','$100–$199','Under $100'];

function groupKey(item, sortBy) {
  if (sortBy === 'date')  return new Date(item.created_at).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  if (sortBy === 'price') {
    const p = parseFloat(item.price) || 0;
    if (p >= 1000) return '$1000+';
    if (p >= 750)  return '$750–$999';
    if (p >= 500)  return '$500–$749';
    if (p >= 200)  return '$200–$499';
    if (p >= 100)  return '$100–$199';
    return 'Under $100';
  }
  if (sortBy === 'type')  return item.type || 'Other';
  return (item.brand || 'Uncategorized').trim().toLowerCase();
}

export default function Inventory({ user, onSignOut, onTotalChange }) {
  const { items, loading, fetchItems, addItem, editItem, removeItem } = useItems(user);
  const player = usePlayer();

  const [sortBy, setSortBy]             = useState('brand');
  const [search, setSearch]             = useState('');
  const [filterType, setFilterType]     = useState('');
  const [filterRecent, setFilterRecent]   = useState(false);
  const [filterPrice, setFilterPrice]   = useState('');
  const [profileOpen, setProfileOpen]   = useState(false);
  const [avatarUrl, setAvatarUrl]       = useState('');
  const [lbItem, setLbItem]             = useState(null);
  const [addOpen, setAddOpen]           = useState(false);
  const [editItem_, setEditItem_]       = useState(null);

  useEffect(() => {
    fetchItems();
  }, [fetchItems]);

  useEffect(() => {
    const key = `garderobe-profile-${user?.id || 'guest'}`;
    try {
      const p = JSON.parse(localStorage.getItem(key) || '{}');
      if (p.avatarUrl) setAvatarUrl(p.avatarUrl);
    } catch {}
  }, [user?.id]);

  // Filter
  const filtered = items.filter(item => {
    if (search) {
      const q = search.toLowerCase();
      if (!item.name?.toLowerCase().includes(q) && !item.brand?.toLowerCase().includes(q)) return false;
    }
    if (filterType && item.type !== filterType) return false;
    if (filterRecent && new Date(item.created_at).getTime() < RECENT_CUTOFF) return false;
    if (filterPrice === 'u100' && (parseFloat(item.price) || 0) >= 100) return false;
    if (filterPrice === '100-500' && ((parseFloat(item.price) || 0) < 100 || (parseFloat(item.price) || 0) > 500)) return false;
    if (filterPrice === '500p' && (parseFloat(item.price) || 0) < 500) return false;
    return true;
  });

  function exportCSV() {
    const cols = ['name','brand','type','size','price','status','condition','purchase_date','created_at'];
    const rows = [cols, ...items.map(item => cols.map(c => `"${String(item[c] ?? '').replace(/"/g, '""')}"`))].map(r => r.join(','));
    const url = URL.createObjectURL(new Blob([rows.join('\n')], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url; a.download = `garderobe-${new Date().toISOString().slice(0,10)}.csv`;
    a.click(); URL.revokeObjectURL(url);
  }

  // Sort & group
  const sorted = [...filtered].sort((a, b) => {
    if (sortBy === 'date')  return new Date(b.created_at) - new Date(a.created_at);
    if (sortBy === 'price') return (parseFloat(b.price) || 0) - (parseFloat(a.price) || 0);
    if (sortBy === 'type')  return (a.type || '').localeCompare(b.type || '');
    return (a.brand || 'Uncategorized').toLowerCase().localeCompare((b.brand || 'Uncategorized').toLowerCase());
  });

  const rawGroups = [...new Set(sorted.map(i => groupKey(i, sortBy)))];
  const groups    = sortBy === 'price' ? PRICE_ORDER.filter(g => rawGroups.includes(g)) : rawGroups;
  const total     = items.filter(i => (i.status || 'owned') === 'owned').reduce((s, i) => s + (parseFloat(i.price) || 0), 0);

  useEffect(() => {
    onTotalChange?.(total);
  }, [total, onTotalChange]);

  async function handleAdd(fields, pending) {
    await addItem(fields, pending);
  }

  async function handleEdit(id, fields, editImgs, originalItem) {
    await editItem(id, fields, editImgs, originalItem);
  }

  return (
    <>
      <div className="root" id="app">
        <div className="header-row">
          <div className="header-left">
            <h1>GARDEROBE</h1>
            <p className="phonetic">/ˈɡärdˌrōb/</p>
            <p className="subtitle">your digital wardrobe for all your grails</p>
          </div>
          <button className="profile-btn" onClick={() => setProfileOpen(true)} title="Profile">
            {avatarUrl
              ? <img src={avatarUrl} alt="avatar" />
              : <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4.4 3.6-8 8-8s8 3.6 8 8"/></svg>
            }
          </button>
        </div>

        <MusicPlayer
          track={player.track}
          trackIdx={player.trackIdx}
          playing={player.playing}
          progress={player.progress}
          timeCur={player.timeCur}
          timeDur={player.timeDur}
          onToggle={player.togglePlay}
          onNext={player.nextTrack}
          onPrev={player.prevTrack}
          onVolume={player.setVolume}
          onSeek={player.seekTo}
        />

        <div className="controls-row">
          <button className="add-btn" style={{ marginBottom: 0 }} onClick={() => setAddOpen(true)}>+ ADD NEW ITEM</button>
          <div className="sort-wrap">
            <span>SORT BY</span>
            <select value={sortBy} onChange={e => setSortBy(e.target.value)}>
              {SORT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
        </div>

        <div className="filter-row">
          <input className="search-input" placeholder="SEARCH NAME, BRAND..." value={search} onChange={e => setSearch(e.target.value)} />
          <select className="filter-select" value={filterType} onChange={e => setFilterType(e.target.value)}>
            <option value="">ALL TYPES</option>
            {ITEM_TYPES.map(t => <option key={t}>{t}</option>)}
          </select>
          <select className="filter-select" value={filterPrice} onChange={e => setFilterPrice(e.target.value)}>
            <option value="">ANY PRICE</option>
            <option value="u100">Under $100</option>
            <option value="100-500">$100–$500</option>
            <option value="500p">$500+</option>
          </select>
          <label className="filter-check"><input type="checkbox" checked={filterRecent} onChange={e => setFilterRecent(e.target.checked)} /> RECENT</label>
        </div>

        {!loading && items.length === 0 && <p className="empty">No items yet. Add your first piece.</p>}
        {!loading && items.length > 0 && filtered.length === 0 && <p className="empty">No items match the current filters.</p>}

        <div id="catalog">
          {groups.map(group => {
            const groupItems = sorted.filter(i => groupKey(i, sortBy) === group);
            return (
              <div key={group} className="brand-section">
                <div className="brand-title">{group.toUpperCase()} ({groupItems.length})</div>
                <hr className="brand-divider" />
                <div className="cards-grid">
                  {groupItems.map(item => (
                    <ItemCard
                      key={item.id}
                      item={item}
                      onRemove={removeItem}
                      onEdit={id => setEditItem_(items.find(i => i.id === id))}
                      onClick={id => setLbItem(items.find(i => i.id === id))}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        <div className="page-copyright">© Leon Meng. All rights reserved.</div>
      </div>

      <ProfilePanel
        open={profileOpen}
        user={user}
        onClose={() => setProfileOpen(false)}
        onSignOut={onSignOut}
        avatarUrl={avatarUrl}
        onExportCSV={items.length > 0 ? exportCSV : null}
        onAvatarChange={url => {
          setAvatarUrl(url);
          const key = `garderobe-profile-${user?.id || 'guest'}`;
          try {
            const p = JSON.parse(localStorage.getItem(key) || '{}');
            localStorage.setItem(key, JSON.stringify({ ...p, avatarUrl: url }));
          } catch {}
        }}
      />

      {lbItem && (
        <Lightbox
          item={lbItem}
          onClose={() => setLbItem(null)}
          onEdit={id => { setLbItem(null); setEditItem_(items.find(i => i.id === id)); }}
        />
      )}

      <AddItemModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onAdd={handleAdd}
      />

      {editItem_ && (
        <EditItemModal
          item={editItem_}
          onClose={() => setEditItem_(null)}
          onSave={handleEdit}
        />
      )}
    </>
  );
}
