const NAV_ITEMS = [
  { k: 'wardrobe',  label: 'WARDROBE' },
  { k: 'outfits',   label: 'OUTFITS' },
  { k: 'timeline',  label: 'TIMELINE' },
  { k: 'wishlist',  label: 'WISHLIST' },
  { k: 'explore',   label: 'EXPLORE' },
  { k: 'friends',   label: 'FRIENDS' },
];

export default function AppNav({ page, setPage, total, requestCount, likeCount }) {
  const activePage = page === 'detail' ? 'wardrobe' : page;
  return (
    <div className="app-nav">
      <div className="app-nav-tabs">
        {NAV_ITEMS.map(it => {
          const badge = it.k === 'friends' ? requestCount : it.k === 'explore' ? likeCount : 0;
          return (
          <button
            key={it.k}
            onClick={() => setPage(it.k)}
            className={`app-nav-tab${activePage === it.k ? ' active' : ''}`}
          >
            {activePage === it.k ? '■' : '□'} {it.label}
            {badge > 0 && <span className="nav-badge">{badge}</span>}
          </button>
        );})}
      </div>
      <div className="app-nav-value">
        COLLECTION VALUE — <strong>${total.toLocaleString()}.00</strong>
      </div>
    </div>
  );
}
