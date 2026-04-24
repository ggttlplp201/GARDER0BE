import { useState, useEffect, useCallback } from 'react';
import { sb } from '../lib/supabase';

function DesignAvatar({ url, size = 60 }) {
  if (url) return (
    <div style={{ width: size, height: size, borderRadius: '50%', border: '1px solid var(--border-light)', overflow: 'hidden', flexShrink: 0 }}>
      <img src={url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
    </div>
  );
  return (
    <div style={{ width: size, height: size, borderRadius: '50%', border: '1px solid var(--border-light)', background: 'var(--bg3)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, color: 'var(--text3)' }}>
      <svg width={size * 0.5} height={size * 0.5} viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4.4 3.6-8 8-8s8 3.6 8 8"/></svg>
    </div>
  );
}

function fmtStats(count, value) {
  const v = value >= 1000 ? Math.round(value / 1000) + 'K' : Math.round(value).toLocaleString();
  return `${count} ITEMS · $${v}`;
}

export default function FriendsPage({ user, onViewProfile, onRequestsViewed }) {
  const [tab, setTab]           = useState('friends');
  const [friends, setFriends]   = useState([]);
  const [incoming, setIncoming] = useState([]);
  const [outgoing, setOutgoing] = useState([]);
  const [likes, setLikes]       = useState([]);
  const [itemStats, setItemStats] = useState({});
  const [loading, setLoading]   = useState(true);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);

    const [{ data: inc }, { data: out }, { data: acc }, { data: lks }] = await Promise.all([
      sb.from('friend_requests').select('id, from_user_id').eq('to_user_id', user.id).eq('status', 'pending'),
      sb.from('friend_requests').select('id, to_user_id').eq('from_user_id', user.id).eq('status', 'pending'),
      sb.from('friend_requests').select('id, from_user_id, to_user_id').or(`from_user_id.eq.${user.id},to_user_id.eq.${user.id}`).eq('status', 'accepted'),
      sb.from('profile_likes').select('id, user_id, created_at').eq('liked_user_id', user.id).order('created_at', { ascending: false }).limit(20),
    ]);

    const ids = new Set([
      ...(inc || []).map(r => r.from_user_id),
      ...(out || []).map(r => r.to_user_id),
      ...(acc || []).flatMap(r => [r.from_user_id, r.to_user_id]),
      ...(lks || []).map(r => r.user_id),
    ].filter(Boolean));

    let profileMap = {};
    if (ids.size > 0) {
      const { data: profiles } = await sb.from('profiles').select('id, username, avatar_url, location').in('id', [...ids]);
      (profiles || []).forEach(p => { profileMap[p.id] = p; });
    }

    const friendList = (acc || []).map(r => {
      const otherId = r.from_user_id === user.id ? r.to_user_id : r.from_user_id;
      const profile = profileMap[otherId];
      return profile ? { ...profile, requestId: r.id } : null;
    }).filter(Boolean);

    // Batch load item stats for friends
    if (friendList.length > 0) {
      const friendIds = friendList.map(f => f.id);
      const { data: friendItems } = await sb.from('items').select('user_id, price, status').in('user_id', friendIds);
      const stats = {};
      for (const it of (friendItems || [])) {
        if (it.status === 'wishlist') continue;
        if (!stats[it.user_id]) stats[it.user_id] = { count: 0, value: 0 };
        stats[it.user_id].count++;
        stats[it.user_id].value += parseFloat(it.price) || 0;
      }
      setItemStats(stats);
    }

    setIncoming((inc || []).map(r => ({ ...r, profile: profileMap[r.from_user_id] || null })));
    setOutgoing((out || []).map(r => ({ ...r, profile: profileMap[r.to_user_id] || null })));
    setLikes((lks || []).map(r => ({ ...r, profile: profileMap[r.user_id] || null })));
    setFriends(friendList);
    setLoading(false);
  }, [user]);

  useEffect(() => { load(); }, [load]);

  async function accept(id) { await sb.from('friend_requests').update({ status: 'accepted' }).eq('id', id); load(); }
  async function decline(id) { await sb.from('friend_requests').delete().eq('id', id); load(); }
  async function unfriend(requestId) { await sb.from('friend_requests').delete().eq('id', requestId); load(); }
  async function cancel(id) { await sb.from('friend_requests').delete().eq('id', id); load(); }

  const pendingCount = incoming.length;

  const tabs = [
    { key: 'friends', label: 'FRIENDS', count: friends.length },
    { key: 'requests', label: 'REQUESTS', count: pendingCount, onActivate: onRequestsViewed },
    { key: 'likes', label: 'LIKES', count: likes.length },
  ];

  return (
    <div className="v-screen">
      <div className="v-screen-header">
        <div>
          <div className="v-screen-title">FRIENDS</div>
          <div className="v-screen-sub">YOUR CONNECTIONS</div>
        </div>
      </div>

      <div className="design-people-tabs" style={{ gridTemplateColumns: '1fr 1fr 1fr', margin: '0 36px' }}>
        {tabs.map(({ key, label, count, onActivate }) => (
          <button
            key={key}
            className={`design-people-tab${tab === key ? ' active' : ''}`}
            onClick={() => { setTab(key); onActivate?.(); }}
          >
            {label}
            {count > 0 && <span className="design-tab-badge">{count}</span>}
          </button>
        ))}
      </div>

      <div className="v-body" style={{ padding: '0 36px 24px' }}>
        {loading && <div className="v-empty">LOADING…</div>}

        {!loading && tab === 'friends' && (
          friends.length === 0
            ? <div className="v-empty">No friends yet — find people in Explore.</div>
            : friends.map(f => {
              const stats = itemStats[f.id];
              return (
                <div key={f.id} className="design-people-row" style={{ cursor: 'pointer' }} onClick={() => onViewProfile(f)}>
                  <DesignAvatar url={f.avatar_url} />
                  <div className="design-people-info">
                    <div className="design-people-name">{f.username || 'Anonymous'}</div>
                    {f.location && <div className="design-people-location">{f.location.toUpperCase()}</div>}
                  </div>
                  {stats && <div className="design-people-stats">{fmtStats(stats.count, stats.value)}</div>}
                  <div className="design-people-actions" onClick={e => e.stopPropagation()}>
                    <button className="design-action-btn" onClick={() => unfriend(f.requestId)}>UNFRIEND</button>
                  </div>
                </div>
              );
            })
        )}

        {!loading && tab === 'requests' && (
          <>
            {incoming.length > 0 && (
              <>
                <div className="friends-section-label">INCOMING</div>
                {incoming.map(r => (
                  <div key={r.id} className="design-people-row">
                    <DesignAvatar url={r.profile?.avatar_url} />
                    <div className="design-people-info">
                      <div className="design-people-name">{r.profile?.username || 'Anonymous'}</div>
                      {r.profile?.location && <div className="design-people-location">{r.profile.location.toUpperCase()}</div>}
                    </div>
                    <div className="design-people-actions">
                      <button className="design-action-btn active" onClick={() => accept(r.id)}>✓ ACCEPT</button>
                      <button className="design-action-btn" style={{ borderColor: 'var(--border-light)', color: 'var(--text2)' }} onClick={() => decline(r.id)}>✕</button>
                    </div>
                  </div>
                ))}
              </>
            )}
            {outgoing.length > 0 && (
              <>
                <div className="friends-section-label">SENT</div>
                {outgoing.map(r => (
                  <div key={r.id} className="design-people-row">
                    <DesignAvatar url={r.profile?.avatar_url} />
                    <div className="design-people-info">
                      <div className="design-people-name">{r.profile?.username || 'Anonymous'}</div>
                      {r.profile?.location && <div className="design-people-location">{r.profile.location.toUpperCase()}</div>}
                    </div>
                    <div className="design-people-actions">
                      <button className="design-action-btn" style={{ borderColor: 'var(--border-light)', color: 'var(--text2)' }} onClick={() => cancel(r.id)}>CANCEL</button>
                    </div>
                  </div>
                ))}
              </>
            )}
            {incoming.length === 0 && outgoing.length === 0 && (
              <div className="v-empty">No pending requests.</div>
            )}
          </>
        )}

        {!loading && tab === 'likes' && (
          likes.length === 0
            ? <div className="v-empty">Nobody has liked your profile yet.</div>
            : likes.map(l => (
              <div key={l.id} className="design-people-row" style={{ cursor: l.profile ? 'pointer' : 'default' }} onClick={() => l.profile && onViewProfile(l.profile)}>
                <DesignAvatar url={l.profile?.avatar_url} />
                <div className="design-people-info">
                  <div className="design-people-name">{l.profile?.username || 'Anonymous'}</div>
                  <div className="design-people-location">{new Date(l.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }).toUpperCase()}</div>
                </div>
                <div style={{ flexShrink: 0, color: '#e05' }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="2">
                    <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
                  </svg>
                </div>
              </div>
            ))
        )}
      </div>
    </div>
  );
}
