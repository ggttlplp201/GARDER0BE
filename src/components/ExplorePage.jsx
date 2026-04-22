import { useState, useEffect, useCallback } from 'react';
import { sb } from '../lib/supabase';
import { parseImageUrls } from '../lib/imageUtils';

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
  const [reqStatus, setReqStatus] = useState(null); // null | 'pending' | 'accepted'

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

export default function ExplorePage({ user, externalProfile, onExternalProfileClear }) {
  const [profiles, setProfiles]               = useState([]);
  const [loading, setLoading]                 = useState(true);
  const [search, setSearch]                   = useState('');
  const [selectedProfile, setSelectedProfile] = useState(null);

  useEffect(() => {
    if (externalProfile) setSelectedProfile(externalProfile);
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
      {!selectedProfile ? (
        <>
          <div className="explore-page-header">
            <div className="explore-title">EXPLORE</div>
            <div className="explore-subtitle">public collections</div>
          </div>
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
      ) : (
        <ProfileView profile={selectedProfile} user={user} onBack={handleBack} />
      )}
    </div>
  );
}
