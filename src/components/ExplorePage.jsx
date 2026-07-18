import { useState, useEffect, useCallback } from 'react';
import { sb } from '../lib/supabase';
import { parseImageUrls } from '../lib/imageUtils';
import { API_URL } from '../lib/constants';
import Avatar from './Avatar';
import Username from './Username';
import FitLikeButton from './FitLikeButton';
import ShareToFriendModal from './ShareToFriendModal';
import CoinIcon from './CoinIcon';
import { getLevelState } from '../lib/levels';
import { COSMETICS } from '../lib/cosmetics';

// ── Feed cache ────────────────────────────────────────────────────────────────
const FEED_CACHE_KEY    = 'garderobe-feed-v1';
const FEED_CACHE_TTL    = 30 * 60 * 1000;
const OUTFITS_PAGE_SIZE = 20;

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

function NewsFeed({ user, onShareToChat }) {
  const [shareArticle, setShareArticle] = useState(null);
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
  }, [user]);

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

  const scoreMap = sort === 'relevance' && articles.length
    ? new Map(articles.map(a => [a, scoreArticle(a, brandFreq, wishlistBrands, profile)]))
    : null;

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
    const scored = [...articles].sort((a, b) => {
      const diff = (scoreMap.get(b) ?? 0) - (scoreMap.get(a) ?? 0);
      return diff !== 0 ? diff : new Date(b.date) - new Date(a.date);
    });
    return diversify(scored).slice(0, 40);
  })();

  if (loading) return <p className="empty">Loading feed...</p>;
  if (error)   return <p className="empty">Couldn't load feed. Try again later.</p>;
  if (!sorted.length) return <p className="empty">No articles found.</p>;

  return (
    <div className="news-feed">
      <div style={{ display: 'flex', gap: 0, border: '1px solid var(--border)', width: 'fit-content', marginBottom: 16 }}>
        <button className={`mode-btn bd-r${sort === 'recent'    ? ' active' : ''}`} onClick={() => setSort('recent')}>RECENT</button>
        <button className={`mode-btn${sort === 'relevance' ? ' active' : ''}`} onClick={() => setSort('relevance')} title="Sorted by brands in your wardrobe">FOR YOU</button>
      </div>
      {sorted.map(a => {
        const score = scoreMap?.get(a) ?? 0;
        return (
          <a key={a.id} className="news-card" href={a.link} target="_blank" rel="noopener noreferrer">
            <div className="news-card-img">
              {a.image
                ? <img src={a.image} alt="" loading="lazy" onError={e => { e.currentTarget.replaceWith(Object.assign(document.createElement('div'), { className: 'news-card-img-placeholder', textContent: (a.source || '').toUpperCase() })); }} />
                : <div className="news-card-img-placeholder">{(a.source || '').toUpperCase()}</div>
              }
            </div>
            <div className="news-card-body">
              <div className="news-card-source">
                {a.source?.toUpperCase()} · {timeAgo(a.date)}
                {sort === 'relevance' && score > 0 && <span className="news-relevance-dot" title={`${score} brand match${score > 1 ? 'es' : ''}`}> ●</span>}
              </div>
              <div className="news-card-title">{a.title}</div>
              {a.desc && <div className="news-card-desc">{a.desc}</div>}
              {onShareToChat && (
                <button className="feed-share-btn" onClick={e => { e.preventDefault(); e.stopPropagation(); setShareArticle(a); }}>↗ SHARE</button>
              )}
            </div>
          </a>
        );
      })}
      {shareArticle && (
        <ShareToFriendModal
          user={user}
          onClose={() => setShareArticle(null)}
          onShare={fid => onShareToChat({ type: 'article', payload: { url: shareArticle.link, title: shareArticle.title, image: shareArticle.image || null } }, fid)}
        />
      )}
    </div>
  );
}

// ── Shared sub-components ─────────────────────────────────────────────────────

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
  const [show, setShow]       = useState(null); // showcase view-model
  const isSelf = profile.id === user?.id;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const [{ data: itemRows }, { data: gs }, { count: fitCount }, { data: uaRows },
              { data: adefs }, { count: profLikes }, { data: prof }] = await Promise.all([
        sb.from('items').select('*').eq('user_id', profile.id).order('created_at', { ascending: false }),
        sb.from('game_state').select('total_xp').eq('user_id', profile.id).maybeSingle(),
        sb.from('outfit_posts').select('id', { count: 'exact', head: true }).eq('user_id', profile.id),
        sb.from('user_achievements').select('achievement_id, unlocked_at').eq('user_id', profile.id).not('unlocked_at', 'is', null),
        sb.from('achievement_defs').select('id, name, xp, sort'),
        sb.from('profile_likes').select('id', { count: 'exact', head: true }).eq('liked_user_id', profile.id),
        sb.from('profiles').select('pinned_item_ids, equipped_frame, equipped_name_effect').eq('id', profile.id).maybeSingle(),
      ]);
      if (cancelled) return;
      const its = itemRows || [];
      // fit likes received: count fit_likes on this user's posts
      const { count: fitLikes } = await sb.from('fit_likes')
        .select('post_id, outfit_posts!inner(user_id)', { count: 'exact', head: true })
        .eq('outfit_posts.user_id', profile.id);
      let coins = null;
      if (isSelf) {
        const { data: w } = await sb.from('wallets').select('coins').eq('user_id', profile.id).maybeSingle();
        coins = w?.coins ?? 0;
      }
      if (cancelled) return; // a newer profile may have been opened during the awaits
      const defMap = Object.fromEntries((adefs || []).map(d => [d.id, d]));
      const unlocked = (uaRows || [])
        .map(r => ({ ...defMap[r.achievement_id], unlocked_at: r.unlocked_at }))
        .filter(a => a.name).sort((a, b) => a.sort - b.sort);
      const owned = its.filter(i => (i.status || 'owned') === 'owned');
      const pins = (prof?.pinned_item_ids || [])
        .map(id => its.find(i => i.id === id)).filter(Boolean);
      setItems(its);
      setShow({
        level: getLevelState(gs?.total_xp || 0).level,
        collectionValue: Math.round(owned.reduce((s, i) => s + (parseFloat(i.price) || 0), 0)),
        coins,
        stats: {
          items: owned.length,
          fits: fitCount || 0,
          wears: owned.reduce((s, i) => s + (i.wear_count || 0), 0),
          likes: (profLikes || 0) + (fitLikes || 0),
        },
        achievements: unlocked,
        pins,
        frame: prof?.equipped_frame ?? profile.equipped_frame,
        nameEffect: prof?.equipped_name_effect ?? profile.equipped_name_effect,
      });
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [profile.id, isSelf]); // eslint-disable-line react-hooks/exhaustive-deps

  const frameName = show?.frame && COSMETICS[show.frame]?.name;
  const fxName    = show?.nameEffect && COSMETICS[show.nameEffect]?.name;

  return (
    <div className="explore-profile-view">
      <button className="explore-back" onClick={onBack}>← BACK</button>
      <div className="explore-profile-header">
        <Avatar url={profile.avatar_url} size={64} frame={show?.frame ?? profile.equipped_frame} />
        <div style={{ flex: 1 }}>
          <div className="explore-profile-name">
            <Username name={profile.username || 'Anonymous'} effect={show?.nameEffect ?? profile.equipped_name_effect} />
            {show && <span className="showcase-lvl">LVL {show.level}</span>}
          </div>
          {profile.location && <div className="explore-profile-meta">{profile.location}</div>}
          {profile.bio && <div className="explore-profile-bio">{profile.bio}</div>}
          {show && (
            <div className="showcase-value">
              ${show.collectionValue.toLocaleString()}
              {isSelf && show.coins != null && <> · {show.coins.toLocaleString()} <CoinIcon size={10} /></>}
            </div>
          )}
        </div>
        {!isSelf && <SocialButtons user={user} profileId={profile.id} />}
      </div>

      {show && (
        <div className="showcase-statrow">
          <span><b>{show.stats.items}</b> ITEMS</span>
          <span><b>{show.stats.fits}</b> FITS</span>
          <span><b>{show.stats.wears}</b> WEARS</span>
          <span><b>{show.stats.likes}</b> LIKES</span>
        </div>
      )}

      {show && (frameName || fxName) && (
        <div className="showcase-loadout">
          <span className="showcase-label">LOADOUT</span>
          {frameName && <span className="showcase-chip">{frameName.toUpperCase()}</span>}
          {fxName && <span className="showcase-chip">{fxName.toUpperCase()}</span>}
        </div>
      )}

      {show && show.pins.length > 0 && (
        <>
          <div className="showcase-label showcase-section">SHOWCASE</div>
          <div className="showcase-pins">
            {show.pins.map(item => <PublicItemCard key={item.id} item={item} />)}
          </div>
        </>
      )}

      {show && show.achievements.length > 0 && (
        <>
          <div className="showcase-label showcase-section">ACHIEVEMENTS</div>
          <div className="showcase-ach-grid">
            {show.achievements.map(a => (
              <div key={a.id} className="showcase-ach">
                <div className="showcase-ach-name">{a.name.toUpperCase()}</div>
                <div className="showcase-ach-xp">+{a.xp} XP</div>
              </div>
            ))}
          </div>
        </>
      )}

      <div className="showcase-label showcase-section">COLLECTION</div>
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

function OutfitsFeed({ user, onShareToChat, onOpenPost }) {
  const [shareFit,  setShareFit]  = useState(null);
  const [filter,    setFilter]    = useState('all');
  const [posts,     setPosts]     = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [hasMore,   setHasMore]   = useState(true);
  const [editingId, setEditingId] = useState(null);
  const [editName,  setEditName]  = useState('');

  const fetchPage = useCallback(async (pageNum) => {
    setLoading(true);
    const from = pageNum * OUTFITS_PAGE_SIZE;
    let query = sb
      .from('outfit_posts')
      .select('*')
      .order('created_at', { ascending: false })
      .range(from, from + OUTFITS_PAGE_SIZE - 1);
    if (filter === 'mine'   && user?.id) query = query.eq('user_id', user.id);
    if (filter === 'others' && user?.id) query = query.neq('user_id', user.id);
    const { data: rows, error } = await query;
    if (error) { console.error('[OutfitsFeed] fetch error:', error); setLoading(false); return; }
    if (rows) {
      const ids = [...new Set(rows.map(r => r.user_id))];
      const { data: profileRows } = ids.length
        ? await sb.from('profiles').select('id, username, avatar_url, equipped_frame, equipped_name_effect').in('id', ids)
        : { data: [] };
      const pm = Object.fromEntries((profileRows || []).map(p => [p.id, p]));
      // Fit-like counts (bounded, server-aggregated) + which the viewer liked
      const postIds = rows.map(r => r.id);
      const counts = {}; const mine = new Set();
      if (postIds.length) {
        const [{ data: countRows }, { data: mineRows }] = await Promise.all([
          sb.rpc('fit_like_counts', { p_ids: postIds }),
          user?.id ? sb.from('fit_likes').select('post_id').eq('user_id', user.id).in('post_id', postIds) : Promise.resolve({ data: [] }),
        ]);
        (countRows || []).forEach(r => { counts[r.post_id] = Number(r.cnt); });
        (mineRows || []).forEach(r => mine.add(r.post_id));
      }
      const enriched = rows.map(r => ({
        ...r, profiles: pm[r.user_id] || null,
        likeCount: counts[r.id] || 0, likedByMe: mine.has(r.id),
      }));
      setPosts(prev => pageNum === 0 ? enriched : [...prev, ...enriched]);
      setHasMore(rows.length === OUTFITS_PAGE_SIZE);
    }
    setLoading(false);
  }, [filter, user]);

  useEffect(() => { fetchPage(0); }, [fetchPage]);

  async function handleDelete(postId) {
    if (!user?.id) return;
    const { error } = await sb.from('outfit_posts').delete().eq('id', postId).eq('user_id', user.id);
    if (!error) setPosts(prev => prev.filter(p => p.id !== postId));
  }

  async function handleRename(postId, newName) {
    const trimmed = newName.trim();
    if (!trimmed) { setEditingId(null); return; }
    const current = posts.find(p => p.id === postId);
    if (current && trimmed === current.fit_name) { setEditingId(null); return; }
    const { error } = await sb.from('outfit_posts').update({ fit_name: trimmed }).eq('id', postId).eq('user_id', user.id);
    if (!error) setPosts(prev => prev.map(p => p.id === postId ? { ...p, fit_name: trimmed } : p));
    setEditingId(null);
  }

  const isMine     = filter === 'mine';
  const showLoad   = loading && posts.length === 0;
  const showEmpty  = !loading && posts.length === 0;
  const filterOpts = user
    ? [['all', 'ALL'], ['mine', 'BY ME'], ['others', 'OTHERS']]
    : [['all', 'ALL']];

  return (
    <div className="outfits-feed">
      <div className="outfits-filter-bar">
        {filterOpts.map(([k, label]) => (
          <button key={k} className={`mode-btn${filter === k ? ' active' : ''}`} onClick={() => setFilter(k)}>{label}</button>
        ))}
      </div>

      {showLoad  && <div className="v-empty">LOADING…</div>}
      {showEmpty && (
        <div className="v-empty">
          {isMine ? "You haven't posted any outfits yet." : 'No outfits posted yet. Be the first.'}
        </div>
      )}
      {!showLoad && !showEmpty && (
        <>
          <div className="outfits-feed-grid">
            {posts.map(post => (
              <div key={post.id} className="outfit-post-card">
                <div className="outfit-post-img-wrap" onClick={() => onOpenPost?.(post.id)}>
                  <img src={post.image_url} alt={post.fit_name} loading="lazy" />
                </div>
                <div className="outfit-post-info">
                  {isMine && editingId === post.id ? (
                    <input
                      className="outfit-post-edit-input"
                      value={editName}
                      autoFocus
                      onChange={e => setEditName(e.target.value)}
                      onBlur={() => handleRename(post.id, editName)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') handleRename(post.id, editName);
                        if (e.key === 'Escape') setEditingId(null);
                      }}
                    />
                  ) : (
                    <div className="outfit-post-name">{post.fit_name}</div>
                  )}
                  <div className="outfit-post-meta">
                    <span className="mono-dim">{post.slot_count} PCS · ${Math.round(post.total_value || 0).toLocaleString()}</span>
                    <span className="mono-dim">{timeAgo(post.created_at)}</span>
                    <FitLikeButton key={`${post.id}-${post.likeCount}-${post.likedByMe}`}
                      postId={post.id} user={user} initialCount={post.likeCount} initialLiked={post.likedByMe} />
                    {onShareToChat && (
                      <button className="feed-share-btn" onClick={() => setShareFit(post)}>↗</button>
                    )}
                  </div>
                  <div className="outfit-post-user">
                    <Avatar url={post.profiles?.avatar_url} size={18} frame={post.profiles?.equipped_frame} />
                    <span className="outfit-post-username">
                      <Username name={post.profiles?.username || 'ANONYMOUS'} effect={post.profiles?.equipped_name_effect} />
                    </span>
                    {isMine && (
                      <div className="outfit-post-actions">
                        <button className="outfit-post-action-btn" title="Rename"
                          onClick={() => { setEditingId(post.id); setEditName(post.fit_name); }}>✎</button>
                        <button className="outfit-post-action-btn outfit-post-action-btn--delete" title="Delete"
                          onClick={() => handleDelete(post.id)}>×</button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
          {hasMore && (
            <button className="mode-btn" style={{ display: 'block', margin: '20px auto 0', padding: '10px 32px' }}
              onClick={() => fetchPage(Math.floor(posts.length / OUTFITS_PAGE_SIZE))} disabled={loading}
            >{loading ? 'LOADING…' : 'LOAD MORE'}</button>
          )}
        </>
      )}
      {shareFit && (
        <ShareToFriendModal
          user={user}
          onClose={() => setShareFit(null)}
          onShare={fid => onShareToChat({ type: 'fit', payload: { postId: shareFit.id, image_url: shareFit.image_url, fit_name: shareFit.fit_name } }, fid)}
        />
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function ExplorePage({ user, externalProfile, onExternalProfileClear, likeCount, onLikesViewed, onShareToChat, onOpenPost }) {
  const [tab, setTab]                             = useState('feed');
  const [profiles, setProfiles]                   = useState([]);
  const [loading, setLoading]                     = useState(true);
  const [search, setSearch]                       = useState('');
  const [selectedProfile, setSelectedProfile]     = useState(null);

  useEffect(() => {
    if (externalProfile) { setSelectedProfile(externalProfile); setTab('people'); }
  }, [externalProfile]);

  // Report the browse-Explore daily quest (idempotent server-side; fire-and-forget)
  useEffect(() => {
    if (!user) return;
    sb.rpc('progress_quest', { p_type: 'browse_explore' }).then(({ error }) => {
      if (error && !/not self-reportable/.test(error.message)) console.error(error);
    });
  }, [user]);

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
    <div className="v-screen">
      {selectedProfile ? (
        <div className="v-body" style={{ padding: '24px 36px' }}>
          <ProfileView profile={selectedProfile} user={user} onBack={handleBack} />
        </div>
      ) : (
        <>
          {/* Header */}
          <div className="v-screen-header">
            <div>
              <div className="v-screen-title">EXPLORE</div>
              <div className="v-screen-sub">FASHION, CULTURE & PEOPLE</div>
            </div>
          </div>

          {/* Tabs */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', margin: '0 36px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
            {[['feed', 'FEED'], ['outfits', 'OUTFITS'], ['people', 'PEOPLE']].map(([k, label]) => (
              <button key={k} onClick={() => { setTab(k); if (k === 'people') onLikesViewed?.(); }} style={{ position: 'relative',
                background: 'none', border: 'none', padding: '14px 0',
                fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.18em',
                cursor: 'pointer', fontWeight: tab === k ? 700 : 400,
                color: tab === k ? 'var(--text)' : 'var(--text2)',
                borderBottom: tab === k ? '2px solid var(--text)' : '2px solid transparent',
                marginBottom: -1,
              }}>{label}{k === 'people' && likeCount > 0 && <span className="nav-badge">{likeCount}</span>}</button>
            ))}
          </div>

          {/* Tab content */}
          <div className="v-body" style={{ padding: '16px 36px 24px' }}>
            {tab === 'people' && (
              <>
                <input
                  className="toolbar-search"
                  style={{ width: '100%', marginBottom: 12, padding: '10px 0', borderBottom: '1px solid var(--border-light)' }}
                  placeholder="SEARCH NAME, LOCATION"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                />
                {loading && <div className="v-empty">LOADING…</div>}
                {!loading && filtered.length === 0 && (
                  <div className="v-empty">{search ? 'No profiles match.' : 'No public profiles yet.'}</div>
                )}
                <div className="explore-grid">
                  {filtered.map(p => (
                    <div key={p.id} className="explore-card" onClick={() => setSelectedProfile(p)}>
                      <Avatar url={p.avatar_url} size={60} frame={p.equipped_frame} />
                      <div className="explore-card-info">
                        <div className="explore-card-name"><Username name={p.username || 'Anonymous'} effect={p.equipped_name_effect} /></div>
                        {p.location && <div className="explore-card-meta">{p.location.toUpperCase()}</div>}
                      </div>
                      <SocialButtons user={user} profileId={p.id} />
                    </div>
                  ))}
                </div>
              </>
            )}
            {tab === 'feed' && <NewsFeed user={user} onShareToChat={onShareToChat} />}
            {tab === 'outfits' && <OutfitsFeed user={user} onShareToChat={onShareToChat} onOpenPost={onOpenPost} />}
          </div>
        </>
      )}
    </div>
  );
}
