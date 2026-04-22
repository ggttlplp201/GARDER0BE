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
  const [loading, setLoading]   = useState(true);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const [{ data: inc }, { data: out }, { data: acc }] = await Promise.all([
      sb.from('friend_requests')
        .select('id, from_user_id, profiles!friend_requests_from_user_id_fkey(id, username, avatar_url, location)')
        .eq('to_user_id', user.id).eq('status', 'pending'),
      sb.from('friend_requests')
        .select('id, to_user_id, profiles!friend_requests_to_user_id_fkey(id, username, avatar_url, location)')
        .eq('from_user_id', user.id).eq('status', 'pending'),
      sb.from('friend_requests')
        .select('id, from_user_id, to_user_id, profiles!friend_requests_from_user_id_fkey(id,username,avatar_url,location), to_profiles:profiles!friend_requests_to_user_id_fkey(id,username,avatar_url,location)')
        .or(`from_user_id.eq.${user.id},to_user_id.eq.${user.id}`)
        .eq('status', 'accepted'),
    ]);
    setIncoming(inc || []);
    setOutgoing(out || []);
    setFriends((acc || []).map(r => {
      const isFrom = r.from_user_id === user.id;
      return isFrom ? r.to_profiles : r.profiles;
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
      </div>

      {loading && <p className="empty">Loading...</p>}

      {!loading && tab === 'friends' && (
        <>
          {friends.length === 0
            ? <p className="empty">No friends yet — find people in Explore.</p>
            : friends.map(f => (
              <div key={f.id} className="friends-row" onClick={() => onViewProfile(f)} style={{ cursor: 'pointer' }}>
                <Avatar url={f.avatar_url} />
                <div className="friends-row-info">
                  <div className="friends-row-name">{f.username || 'Anonymous'}</div>
                  {f.location && <div className="friends-row-meta">{f.location}</div>}
                </div>
                <span className="friends-row-arrow">›</span>
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
                  <Avatar url={r.profiles?.avatar_url} />
                  <div className="friends-row-info">
                    <div className="friends-row-name">{r.profiles?.username || 'Anonymous'}</div>
                    {r.profiles?.location && <div className="friends-row-meta">{r.profiles.location}</div>}
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
                  <Avatar url={r.profiles?.avatar_url} />
                  <div className="friends-row-info">
                    <div className="friends-row-name">{r.profiles?.username || 'Anonymous'}</div>
                    {r.profiles?.location && <div className="friends-row-meta">{r.profiles.location}</div>}
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
    </div>
  );
}
