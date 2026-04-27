function Icon({ d, children, size = 22 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      {d ? <path d={d} /> : children}
    </svg>
  );
}

const NAV_ITEMS = [
  {
    k: 'wardrobe', label: 'WARDROBE',
    icon: (
      <Icon>
        <path d="M12 4a1.5 1.5 0 1 1 1.5 1.5H12M12 5.5L4 19h16L12 5.5z" />
      </Icon>
    ),
  },
  {
    k: 'outfits', label: 'OUTFITS',
    icon: (
      <Icon>
        <path d="M3 8l4-5h3a2 2 0 0 0 4 0h3l4 5-2.5 2V20H5.5V10L3 8z" />
      </Icon>
    ),
  },
  {
    k: 'timeline', label: 'TIMELINE',
    icon: (
      <Icon>
        <rect x="3" y="4" width="18" height="18" rx="2" />
        <line x1="16" y1="2" x2="16" y2="6" />
        <line x1="8" y1="2" x2="8" y2="6" />
        <line x1="3" y1="10" x2="21" y2="10" />
      </Icon>
    ),
  },
  {
    k: 'wishlist', label: 'WISHLIST',
    icon: (
      <Icon>
        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
      </Icon>
    ),
  },
  {
    k: 'explore', label: 'EXPLORE',
    icon: (
      <Icon>
        <circle cx="12" cy="12" r="10" />
        <polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76" />
      </Icon>
    ),
  },
  {
    k: 'friends', label: 'FRIENDS',
    icon: (
      <Icon>
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
      </Icon>
    ),
  },
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
              <span className="nav-tab-icon">{it.icon}</span>
              <span className="nav-tab-label">{activePage === it.k ? '■' : '□'} {it.label}</span>
              {badge > 0 && <span className="nav-badge">{badge}</span>}
            </button>
          );
        })}
      </div>
      <div className="app-nav-value">
        COLLECTION VALUE — <strong>${total.toLocaleString()}.00</strong>
      </div>
    </div>
  );
}
