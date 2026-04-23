import { useState, useEffect, useCallback } from 'react';
import { sb } from '../lib/supabase';
import { parseImageUrls } from '../lib/imageUtils';
import { API_URL } from '../lib/constants';

// ── Feed cache ────────────────────────────────────────────────────────────────
const FEED_CACHE_KEY = 'garderobe-feed-v1';
const FEED_CACHE_TTL = 30 * 60 * 1000;

// ── Time display ──────────────────────────────────────────────────────────────
function timeAgo(dateStr) {
  if (!dateStr) return 'recent';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return 'recent';
  const diff = Date.now() - d.getTime();
  if (diff < 0) return 'recent';
  const h = Math.floor(diff / 3600000);
  if (h < 1)  return 'just now';
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// ── Brand matching ────────────────────────────────────────────────────────────
// Brands that are too short or generic for simple substring matching
const AMBIGUOUS_BRANDS = new Set(['ami', 'lv', 'fog', 'play', 'cdg', 'ald', 'y-3', 'mm6', 'huf', 'arc']);

function brandMatches(text, brand) {
  const b = brand.toLowerCase();
  const escaped = b.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (b.length <= 3 || AMBIGUOUS_BRANDS.has(b)) {
    // Require no alphanumeric character on either side
    return new RegExp(`(?<![a-zA-Z0-9])${escaped}(?![a-zA-Z0-9])`, 'i').test(text);
  }
  if (b.includes(' ')) {
    return text.includes(b); // multi-word brands are specific enough
  }
  return new RegExp(`\\b${escaped}\\b`, 'i').test(text);
}

// ── Wardrobe profiling ────────────────────────────────────────────────────────
const STREETWEAR_BRANDS = new Set([
  'supreme', 'palace', 'stussy', 'bape', 'a bathing ape', 'kith', 'off-white', 'off white',
  'fear of god', 'essentials', 'fog', 'carhartt', 'dickies', 'vans', 'nike', 'adidas',
  'new balance', 'jordan', 'air jordan', 'converse', 'champion', 'huf', 'thrasher',
  'anti social social club', 'assc', 'noah', 'aime leon dore', 'ald', 'rhude', 'vlone',
  'gallery dept', 'cactus plant flea market', 'cpfm', 'golf wang', 'pleasures',
  'corteiz', 'trapstar', 'sp5der', 'hellstar', 'eric emanuel', 'ksubi', 'represent',
  'human made', 'undercover', 'neighborhood', 'wtaps', 'visvim', 'stone island',
  'patagonia', 'the north face', 'columbia', 'puma', 'reebok', 'asics', 'salomon',
]);

const LUXURY_BRANDS = new Set([
  'louis vuitton', 'lv', 'gucci', 'prada', 'chanel', 'hermes', 'hermès', 'dior',
  'saint laurent', 'ysl', 'balenciaga', 'givenchy', 'bottega veneta', 'fendi',
  'versace', 'valentino', 'burberry', 'alexander mcqueen', 'mcqueen',
  'rick owens', 'maison margiela', 'margiela', 'mm6', 'acne studios', 'vetements',
  'loewe', 'celine', 'jil sander', 'issey miyake', 'yohji yamamoto', 'y-3',
  'comme des garcons', 'cdg', 'play', 'moncler', 'canada goose', 'loro piana',
  'brunello cucinelli', 'tom ford', 'ralph lauren', 'polo ralph lauren',
  'ami', 'jacquemus', 'casablanca', 'wales bonner', 'craig green', 'marni',
  'diesel', 'dsquared2', 'moschino', 'dolce gabbana', 'dolce & gabbana',
]);

const STREETWEAR_KEYWORDS = [
  'streetwear', 'sneaker', 'drop', 'collab', 'hype', 'grail', 'resell',
  'colorway', 'restock', 'limited edition', 'hypebeast', 'cop', 'release date',
];
const LUXURY_KEYWORDS = [
  'luxury', 'runway', 'couture', 'fashion week', 'editorial', 'atelier',
  'collection', 'lookbook', 'ss25', 'fw25', 'ss24', 'fw24', 'resort', 'menswear',
];

function getWardrobeProfile(ownedBrands) {
  let streetwear = 0, luxury = 0;
  for (const brand of ownedBrands) {
    const b = brand.toLowerCase();
    if (STREETWEAR_BRANDS.has(b)) streetwear++;
    if (LUXURY_BRANDS.has(b)) luxury++;
  }
  const total = streetwear + luxury;
  // Need ≥3 categorized brands and ≥40% dominance to assign a lean
  const confidence = total >= 3 ? Math.abs(streetwear - luxury) / total : 0;
  const lean = confidence >= 0.4 ? (streetwear >= luxury ? 'streetwear' : 'luxury') : 'neutral';
  return { streetwear, luxury, lean, confidence };
}

// brandFreq: { brandName: count } for owned items
// wishlistBrands: [brandName] for wishlist items
function scoreArticle(article, brandFreq, wishlistBrands, profile) {
  const hasData = Object.keys(brandFreq).length > 0 || wishlistBrands.length > 0;
  if (!hasData) return 0;
  const text = (article.title + ' ' + article.desc).toLowerCase();
  let score = 0;

  // Owned brand matches — weighted by how many items of that brand
  for (const [brand, count] of Object.entries(brandFreq)) {
    if (brandMatches(text, brand)) score += 2 + Math.min(count - 1, 3);
  }

  // Wishlist brand matches
  for (const brand of wishlistBrands) {
    if (brandMatches(text, brand)) score += 2;
  }

  // Category keyword boost — only when wardrobe has a clear lean
  if (profile?.lean && profile.lean !== 'neutral') {
    const keywords = profile.lean === 'streetwear' ? STREETWEAR_KEYWORDS : LUXURY_KEYWORDS;
    score += keywords.filter(k => text.includes(k)).length * 0.5;
  }

  // Recency bonus
  if (article.date) {
    const age = Date.now() - new Date(article.date).getTime();
    if (!isNaN(age) && age >= 0) {
      if (age < 86_400_000)  score += 1;    // <24h
      else if (age < 604_800_000) score += 0.5; // <7d
    }
  }

  return score;
}

// Ensure top N articles aren't dominated by one source
function diversify(articles, maxPerSource = 2, topN = 8) {
  const top = [], rest = [], counts = {};
  for (const a of articles) {
    const c = counts[a.source] || 0;
    if (top.length < topN && c < maxPerSource) { top.push(a); counts[a.source] = c + 1; }
    else rest.push(a);
  }
  return [...top, ...rest];
}

function interleave(groups) {
  const result = [];
  const maxLen = Math.max(0, ...groups.map(g => g.length));
  for (let i = 0; i < maxLen; i++) {
    for (const group of groups) {
      if (i < group.length) result.push(group[i]);
    }
  }
  return result;
}

function NewsFeed({ user }) {
  const [articles, setArticles]         = useState([]);
  const [brandFreq, setBrandFreq]       = useState({});
  const [wishlistBrands, setWishlist]   = useState([]);
  const [profile, setProfile]           = useState(null);
  const [loading, setLoading]           = useState(true);
  const [error, setError]               = useState(false);
  const [sort, setSort]                 = useState('recent');

  // Fetch wardrobe brands with frequency + wishlist separation
  useEffect(() => {
    if (!user) return;
    sb.from('items').select('brand, status').eq('user_id', user.id).then(({ data }) => {
      const freq = {}, wishlist = new Set();
      for (const item of (data || [])) {
        if (!item.brand) continue;
        const b = item.brand.toLowerCase();
        if (item.status === 'wishlist') wishlist.add(b);
        else freq[b] = (freq[b] || 0) + 1;
      }
      setBrandFreq(freq);
      setWishlist([...wishlist]);
      setProfile(getWardrobeProfile(Object.keys(freq)));
    });
  }, [user?.id]);

  // Fetch articles from backend (with sessionStorage cache)
  useEffect(() => {
    try {
      const cached = JSON.parse(sessionStorage.getItem(FEED_CACHE_KEY) || 'null');
      if (cached && Date.now() - cached.ts < FEED_CACHE_TTL) {
        setArticles(cached.articles);
        setLoading(false);
        return;
      }
    } catch {}

    async function load() {
      try {
        const res = await fetch(`${API_URL}/feed/articles`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const { articles: raw } = await res.json();
        sessionStorage.setItem(FEED_CACHE_KEY, JSON.stringify({ ts: Date.now(), articles: raw }));
        setArticles(raw);
      } catch (e) {
        console.error('[feed] failed:', e);
        setError(true);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const sorted = (() => {
    if (!articles.length) return [];
    if (sort === 'recent') {
      // Group by source, interleave round-robin for variety
      const groups = {};
      for (const a of articles) (groups[a.source] = groups[a.source] || []).push(a);
      return interleave(
        Object.values(groups).map(g => g.sort((a, b) => new Date(b.date) - new Date(a.date)))
      ).slice(0, 40);
    }
    // FOR YOU: score → sort → diversity pass
    const scored = [...articles].sort((a, b) => {
      const diff = scoreArticle(b, brandFreq, wishlistBrands, profile)
                 - scoreArticle(a, brandFreq, wishlistBrands, profile);
      return diff !== 0 ? diff : new Date(b.date) - new Date(a.date);
    });
    return diversify(scored).slice(0, 40);
  })();

  if (loading) return <p className="empty">Loading feed...</p>;
  if (error)   return <p className="empty">Couldn't load feed. Try again later.</p>;
  if (!sorted.length) return <p className="empty">No articles found.</p>;

  return (
    <div className="news-feed">
      <div className="news-sort-row">
        <button className={`news-sort-btn${sort === 'recent'    ? ' active' : ''}`} onClick={() => setSort('recent')}>RECENT</button>
        <button className={`news-sort-btn${sort === 'relevance' ? ' active' : ''}`} onClick={() => setSort('relevance')} title="Sorted by brands in your wardrobe">FOR YOU</button>
      </div>
      {sorted.map(a => {
        const score = scoreArticle(a, brandFreq, wishlistBrands, profile);
        return (
          <a key={a.id} className="news-card" href={a.link} target="_blank" rel="noopener noreferrer">
            {a.image && (
              <div className="news-card-img">
                <img src={a.image} alt="" loading="lazy" onError={e => { e.currentTarget.parentElement.style.display = 'none'; }} />
              </div>
            )}
            <div className="news-card-body">
              <div className="news-card-source">
                {a.source} · {timeAgo(a.date)}
                {sort === 'relevance' && score > 0 && <span className="news-relevance-dot" title={`${score} brand match${score > 1 ? 'es' : ''}`}> ●</span>}
              </div>
              <div className="news-card-title">{a.title}</div>
              {a.desc && <div className="news-card-desc">{a.desc}</div>}
            </div>
          </a>
        );
      })}
    </div>
  );
}

// ── Shared sub-components ─────────────────────────────────────────────────────

function Avatar({ url, size = 52 }) {
  if (url) return <img src={url} alt="" style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover', border: '2px solid black', flexShrink: 0 }} />;
  return (
    <div style={{ width: size, height: size, borderRadius: '50%', border: '2px solid black', background: '#f0f0f0', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, color: '#bbb' }}>
      <svg width={size * 0.55} height={size * 0.55} viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4.4 3.6-8 8-8s8 3.6 8 8"/></svg>
    </div>
  );
}

function PublicItemCard({ item }) {
  const [imgIdx, setImgIdx] = useState(0);
  const imgUrls  = parseImageUrls(item.image_url);
  const multiImg = imgUrls.length > 1;

  function nav(dir, e) {
    e.stopPropagation();
    setImgIdx(i => (i + dir + imgUrls.length) % imgUrls.length);
  }

  return (
    <div className="item-card" style={{ cursor: 'default' }}>
      <div className="card-image-area">
        {imgUrls.length
          ? <img src={imgUrls[imgIdx]} alt={item.name} />
          : <span style={{ fontSize: 13, color: '#aaa' }}>No image</span>
        }
        {multiImg && <>
          <button className="card-img-arrow card-img-prev" onClick={e => nav(-1, e)}>‹</button>
          <button className="card-img-arrow card-img-next" onClick={e => nav(1, e)}>›</button>
          <div className="card-img-counter">{imgIdx + 1}/{imgUrls.length}</div>
        </>}
        <div className="card-shine" />
      </div>
      <div className="card-info">
        {item.status === 'wishlist' && <span className="card-status-badge">WISHLIST</span>}
        <div className="card-name">{item.name || 'Untitled'}</div>
        <div className="card-brand">{item.brand || '—'}</div>
        <div className="card-type">{item.type}{item.condition ? ` · ${item.condition}` : ''}</div>
        {item.size  && <div className="card-type">{item.size}</div>}
        {item.price > 0 && <div className="card-price">${parseFloat(item.price).toLocaleString()}</div>}
      </div>
    </div>
  );
}

function SocialButtons({ user, profileId, onRequestSent }) {
  const [liked, setLiked]         = useState(false);
  const [reqStatus, setReqStatus] = useState(null);

  useEffect(() => {
    if (!user || user.id === profileId) return;
    Promise.all([
      sb.from('profile_likes').select('id').eq('user_id', user.id).eq('liked_user_id', profileId).maybeSingle(),
      sb.from('friend_requests')
        .select('id, status, from_user_id')
        .or(`and(from_user_id.eq.${user.id},to_user_id.eq.${profileId}),and(from_user_id.eq.${profileId},to_user_id.eq.${user.id})`)
        .maybeSingle(),
    ]).then(([{ data: l }, { data: r }]) => {
      setLiked(!!l);
      setReqStatus(r?.status || null);
    });
  }, [user, profileId]);

  if (!user || user.id === profileId) return null;

  async function toggleLike() {
    if (liked) {
      await sb.from('profile_likes').delete().eq('user_id', user.id).eq('liked_user_id', profileId);
      setLiked(false);
    } else {
      await sb.from('profile_likes').insert({ user_id: user.id, liked_user_id: profileId });
      setLiked(true);
    }
  }

  async function sendRequest() {
    if (reqStatus) return;
    await sb.from('friend_requests').insert({ from_user_id: user.id, to_user_id: profileId, status: 'pending' });
    setReqStatus('pending');
    onRequestSent?.();
  }

  const reqLabel = reqStatus === 'accepted' ? 'FRIENDS' : reqStatus === 'pending' ? 'REQUESTED' : '+ ADD';

  return (
    <div className="social-buttons">
      <button className={`social-btn like${liked ? ' active' : ''}`} onClick={e => { e.stopPropagation(); toggleLike(); }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill={liked ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2">
          <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
        </svg>
      </button>
      <button
        className={`social-btn add-friend${reqStatus ? ' sent' : ''}`}
        onClick={e => { e.stopPropagation(); sendRequest(); }}
        disabled={!!reqStatus}
      >
        {reqLabel}
      </button>
    </div>
  );
}

function ProfileView({ profile, user, onBack }) {
  const [items, setItems]     = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    sb.from('items').select('*').eq('user_id', profile.id).order('created_at', { ascending: false })
      .then(({ data }) => { setItems(data || []); setLoading(false); });
  }, [profile.id]);

  const owned    = items.filter(i => (i.status || 'owned') === 'owned');
  const wishlist = items.filter(i => i.status === 'wishlist');

  return (
    <div className="explore-profile-view">
      <button className="explore-back" onClick={onBack}>← BACK</button>
      <div className="explore-profile-header">
        <Avatar url={profile.avatar_url} size={64} />
        <div style={{ flex: 1 }}>
          <div className="explore-profile-name">{profile.username || 'Anonymous'}</div>
          {profile.location  && <div className="explore-profile-meta">{profile.location}</div>}
          {profile.bio       && <div className="explore-profile-bio">{profile.bio}</div>}
        </div>
        <SocialButtons user={user} profileId={profile.id} />
      </div>
      <div className="explore-profile-stats">
        <span>{owned.length} owned</span>
        {wishlist.length > 0 && <span>{wishlist.length} wishlist</span>}
      </div>
      {loading && <p className="empty">Loading...</p>}
      {!loading && items.length === 0 && <p className="empty">No items in this collection.</p>}
      {!loading && items.length > 0 && (
        <div className="cards-grid">
          {items.map(item => <PublicItemCard key={item.id} item={item} />)}
        </div>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function ExplorePage({ user, externalProfile, onExternalProfileClear }) {
  const [tab, setTab]                             = useState('people');
  const [profiles, setProfiles]                   = useState([]);
  const [loading, setLoading]                     = useState(true);
  const [search, setSearch]                       = useState('');
  const [selectedProfile, setSelectedProfile]     = useState(null);

  useEffect(() => {
    if (externalProfile) { setSelectedProfile(externalProfile); setTab('people'); }
  }, [externalProfile]);

  const load = useCallback(() => {
    setLoading(true);
    sb.from('profiles').select('*').eq('is_public', true).order('updated_at', { ascending: false })
      .then(({ data }) => { setProfiles(data || []); setLoading(false); });
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = profiles.filter(p => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (p.username || '').toLowerCase().includes(q) ||
           (p.location  || '').toLowerCase().includes(q);
  });

  function handleBack() {
    setSelectedProfile(null);
    onExternalProfileClear?.();
  }

  return (
    <div className="explore-page">
      {selectedProfile ? (
        <ProfileView profile={selectedProfile} user={user} onBack={handleBack} />
      ) : (
        <>
          <div className="explore-page-header">
            <div className="explore-title">EXPLORE</div>
            <div className="explore-subtitle">{tab === 'people' ? 'public collections' : 'fashion & culture'}</div>
          </div>

          <div className="friends-tabs" style={{ marginBottom: 16 }}>
            <button className={`friends-tab${tab === 'people' ? ' active' : ''}`} onClick={() => setTab('people')}>PEOPLE</button>
            <button className={`friends-tab${tab === 'feed'   ? ' active' : ''}`} onClick={() => setTab('feed')}>FEED</button>
          </div>

          {tab === 'people' && (
            <>
              <input
                className="search-input"
                style={{ marginBottom: 20, width: '100%', boxSizing: 'border-box' }}
                placeholder="SEARCH NAME, LOCATION"
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
              {loading && <p className="empty">Loading...</p>}
              {!loading && filtered.length === 0 && (
                <p className="empty">{search ? 'No profiles match.' : 'No public profiles yet.'}</p>
              )}
              <div className="explore-grid">
                {filtered.map(p => (
                  <div key={p.id} className="explore-card" onClick={() => setSelectedProfile(p)}>
                    <Avatar url={p.avatar_url} size={48} />
                    <div className="explore-card-info">
                      <div className="explore-card-name">{p.username || 'Anonymous'}</div>
                      {p.location && <div className="explore-card-meta">{p.location}</div>}
                    </div>
                    <SocialButtons user={user} profileId={p.id} />
                  </div>
                ))}
              </div>
            </>
          )}

          {tab === 'feed' && <NewsFeed user={user} />}
        </>
      )}
    </div>
  );
}
