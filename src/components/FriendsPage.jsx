import { useState, useEffect, useCallback } from 'react';
import { sb } from '../lib/supabase';

function Avatar({ url, size = 44 }) {
  if (url) return <img src={url} alt="" style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover', border: '2px solid black', flexShrink: 0 }} />;
  return (
    <div style={{ width: size, height: size, borderRadius: '50%', border: '2px solid black', background: '#f0f0f0', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, color: '#bbb' }}>
      <svg width={size * 0.55} height={size * 0.55} viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4.4 3.6-8 8-8s8 3.6 8 8"/></svg>
    </div>
  );
}

export default function FriendsPage({ user, onViewProfile }) {
  const [tab, setTab]           = useState('friends');
  const [friends, setFriends]   = useState([]);
  const [incoming, setIncoming] = useState([]);
  const [outgoing, setOutgoing] = useState([]);
  const [likes, setLikes]       = useState([]);
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

    // Collect all user IDs we need profiles for
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

    setIncoming((inc || []).map(r => ({ ...r, profile: profileMap[r.from_user_id] || null })));
    setOutgoing((out || []).map(r => ({ ...r, profile: profileMap[r.to_user_id] || null })));
    setLikes((lks || []).map(r => ({ ...r, profile: profileMap[r.user_id] || null })));
    setFriends((acc || []).map(r => {
      const otherId = r.from_user_id === user.id ? r.to_user_id : r.from_user_id;
      const profile = profileMap[otherId];
      return profile ? { ...profile, requestId: r.id } : null;
    }).filter(Boolean));
    setLoading(false);
  }, [user]);

  useEffect(() => { load(); }, [load]);

  async function accept(id) {
    await sb.from('friend_requests').update({ status: 'accepted' }).eq('id', id);
    load();
  }
  async function decline(id) {
    await sb.from('friend_requests').delete().eq('id', id);
    load();
  }
  async function unfriend(requestId) {
    await sb.from('friend_requests').delete().eq('id', requestId);
    load();
  }
  async function cancel(id) {
    await sb.from('friend_requests').delete().eq('id', id);
    load();
  }

  const pendingCount = incoming.length;

  return (
    <div className="explore-page">
      <div className="explore-page-header">
        <div className="explore-title">FRIENDS</div>
        <div className="explore-subtitle">your connections</div>
      </div>

      <div className="friends-tabs">
        <button className={`friends-tab${tab === 'friends' ? ' active' : ''}`} onClick={() => setTab('friends')}>
          FRIENDS {friends.length > 0 && <span className="friends-count">{friends.length}</span>}
        </button>
        <button className={`friends-tab${tab === 'requests' ? ' active' : ''}`} onClick={() => setTab('requests')}>
          REQUESTS {pendingCount > 0 && <span className="friends-badge">{pendingCount}</span>}
        </button>
        <button className={`friends-tab${tab === 'likes' ? ' active' : ''}`} onClick={() => setTab('likes')}>
          LIKES {likes.length > 0 && <span className="friends-count">{likes.length}</span>}
        </button>
      </div>

      {loading && <p className="empty">Loading...</p>}

      {!loading && tab === 'friends' && (
        <>
          {friends.length === 0
            ? <p className="empty">No friends yet — find people in Explore.</p>
            : friends.map(f => (
              <div key={f.id} className="friends-row">
                <div style={{ display: 'flex', alignItems: 'center', gap: 14, flex: 1, cursor: 'pointer', minWidth: 0 }} onClick={() => onViewProfile(f)}>
                  <Avatar url={f.avatar_url} />
                  <div className="friends-row-info">
                    <div className="friends-row-name">{f.username || 'Anonymous'}</div>
                    {f.location && <div className="friends-row-meta">{f.location}</div>}
                  </div>
                </div>
                <button className="friend-btn decline" onClick={() => unfriend(f.requestId)}>UNFRIEND</button>
              </div>
            ))
          }
        </>
      )}

      {!loading && tab === 'requests' && (
        <>
          {incoming.length > 0 && (
            <>
              <div className="friends-section-label">INCOMING</div>
              {incoming.map(r => (
                <div key={r.id} className="friends-row">
                  <Avatar url={r.profile?.avatar_url} />
                  <div className="friends-row-info">
                    <div className="friends-row-name">{r.profile?.username || 'Anonymous'}</div>
                    {r.profile?.location && <div className="friends-row-meta">{r.profile.location}</div>}
                  </div>
                  <div className="friends-row-actions">
                    <button className="friend-btn accept" onClick={() => accept(r.id)}>✓</button>
                    <button className="friend-btn decline" onClick={() => decline(r.id)}>✕</button>
                  </div>
                </div>
              ))}
            </>
          )}
          {outgoing.length > 0 && (
            <>
              <div className="friends-section-label">SENT</div>
              {outgoing.map(r => (
                <div key={r.id} className="friends-row">
                  <Avatar url={r.profile?.avatar_url} />
                  <div className="friends-row-info">
                    <div className="friends-row-name">{r.profile?.username || 'Anonymous'}</div>
                    {r.profile?.location && <div className="friends-row-meta">{r.profile.location}</div>}
                  </div>
                  <button className="friend-btn cancel" onClick={() => cancel(r.id)}>CANCEL</button>
                </div>
              ))}
            </>
          )}
          {incoming.length === 0 && outgoing.length === 0 && (
            <p className="empty">No pending requests.</p>
          )}
        </>
      )}

      {!loading && tab === 'likes' && (
        <>
          {likes.length === 0
            ? <p className="empty">Nobody has liked your profile yet.</p>
            : likes.map(l => (
              <div key={l.id} className="friends-row" onClick={() => l.profile && onViewProfile(l.profile)} style={{ cursor: l.profile ? 'pointer' : 'default' }}>
                <Avatar url={l.profile?.avatar_url} />
                <div className="friends-row-info">
                  <div className="friends-row-name">{l.profile?.username || 'Anonymous'}</div>
                  <div className="friends-row-meta">{new Date(l.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</div>
                </div>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="2" style={{ color: '#e05', flexShrink: 0 }}>
                  <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
                </svg>
              </div>
            ))
          }
        </>
      )}
    </div>
  );
}
