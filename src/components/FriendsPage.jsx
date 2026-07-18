import { useState, useEffect, useCallback, useRef } from 'react';
import { sb } from '../lib/supabase';
import { parseImageUrls } from '../lib/imageUtils';
import Avatar from './Avatar';
import Username from './Username';
import FitLikeButton from './FitLikeButton';

function fmtStats(count, value) {
  const v = value >= 1000 ? Math.round(value / 1000) + 'K' : Math.round(value).toLocaleString();
  return `${count} ITEMS · $${v}`;
}

function timeAgo(iso) {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'now';
  if (s < 3600) return Math.floor(s / 60) + 'm';
  if (s < 86400) return Math.floor(s / 3600) + 'h';
  return Math.floor(s / 86400) + 'd';
}

export default function FriendsPage({ user, onViewProfile, onRequestsViewed, onMessage }) {
  const [tab, setTab]           = useState('friends');
  const [friends, setFriends]   = useState([]);
  const [incoming, setIncoming] = useState([]);
  const [outgoing, setOutgoing] = useState([]);
  const [likes, setLikes]       = useState([]);
  const [itemStats, setItemStats] = useState({});
  const [loading, setLoading]   = useState(true);
  const [feed, setFeed]         = useState([]);
  const [feedLoading, setFeedLoading] = useState(false);
  const [feedShown, setFeedShown] = useState(10);

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
      const { data: profiles } = await sb.from('profiles').select('id, username, avatar_url, location, equipped_frame, equipped_name_effect').in('id', [...ids]);
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

  // Realtime: reload when friend requests or likes change
  useEffect(() => {
    if (!user) return;
    const ch = sb.channel('friends-page-' + user.id)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'friend_requests', filter: `to_user_id=eq.${user.id}` }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'friend_requests', filter: `from_user_id=eq.${user.id}` }, load)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'profile_likes', filter: `liked_user_id=eq.${user.id}` }, load)
      .subscribe();
    return () => sb.removeChannel(ch);
  }, [user, load]);

  // Query-time activity feed: merge friends' recent items / fits / achievements.
  const feedGenRef = useRef(0);
  const loadFeed = useCallback(async () => {
    const friendIds = friends.map(f => f.id);
    if (!friendIds.length) { setFeed([]); return; }
    const gen = ++feedGenRef.current;
    setFeedLoading(true);
    const [{ data: items }, { data: fits }, { data: achs }, { data: adefs }] = await Promise.all([
      sb.from('items').select('id, user_id, name, image_url, created_at').in('user_id', friendIds).or('status.eq.owned,status.is.null').order('created_at', { ascending: false }).limit(20),
      sb.from('outfit_posts').select('id, user_id, fit_name, image_url, created_at').in('user_id', friendIds).order('created_at', { ascending: false }).limit(20),
      sb.from('user_achievements').select('user_id, achievement_id, unlocked_at').in('user_id', friendIds).not('unlocked_at', 'is', null).order('unlocked_at', { ascending: false }).limit(20),
      sb.from('achievement_defs').select('id, name, xp'),
    ]);
    const defMap = Object.fromEntries((adefs || []).map(d => [d.id, d]));
    // Fit-like counts (bounded, server-aggregated) + which the viewer liked
    const fitIds = (fits || []).map(f => f.id);
    const counts = {}; const mine = new Set();
    if (fitIds.length) {
      const [{ data: countRows }, { data: mineRows }] = await Promise.all([
        sb.rpc('fit_like_counts', { p_ids: fitIds }),
        sb.from('fit_likes').select('post_id').eq('user_id', user.id).in('post_id', fitIds),
      ]);
      (countRows || []).forEach(r => { counts[r.post_id] = Number(r.cnt); });
      (mineRows || []).forEach(r => mine.add(r.post_id));
    }
    if (gen !== feedGenRef.current) return; // a newer feed load superseded this one
    const merged = [
      ...(items || []).map(r => ({ key: 'i' + r.id, type: 'item', actorId: r.user_id, ts: r.created_at, name: r.name, image: parseImageUrls(r.image_url)[0] })),
      ...(fits || []).map(r => ({ key: 'f' + r.id, type: 'fit', actorId: r.user_id, ts: r.created_at, name: r.fit_name, image: r.image_url, postId: r.id, likeCount: counts[r.id] || 0, likedByMe: mine.has(r.id) })),
      ...(achs || []).map(r => ({ key: 'a' + r.user_id + r.achievement_id, type: 'achievement', actorId: r.user_id, ts: r.unlocked_at, name: defMap[r.achievement_id]?.name || r.achievement_id, xp: defMap[r.achievement_id]?.xp })),
    ].sort((a, b) => new Date(b.ts) - new Date(a.ts));
    setFeed(merged);
    setFeedShown(10);
    setFeedLoading(false);
  }, [friends, user]);

  useEffect(() => { if (tab === 'activity') loadFeed(); }, [tab, loadFeed]);

  async function accept(id) { await sb.from('friend_requests').update({ status: 'accepted' }).eq('id', id); load(); }
  async function decline(id) { await sb.from('friend_requests').delete().eq('id', id); load(); }
  async function unfriend(requestId) { await sb.from('friend_requests').delete().eq('id', requestId); load(); }
  async function cancel(id) { await sb.from('friend_requests').delete().eq('id', id); load(); }

  const pendingCount = incoming.length;

  const tabs = [
    { key: 'friends', label: 'FRIENDS', count: friends.length },
    { key: 'activity', label: 'ACTIVITY', count: 0 },
    { key: 'requests', label: 'REQUESTS', count: pendingCount, onActivate: onRequestsViewed },
    { key: 'likes', label: 'LIKES', count: likes.length },
  ];
  const friendsMap = Object.fromEntries(friends.map(f => [f.id, f]));

  return (
    <div className="v-screen">
      <div className="v-screen-header">
        <div>
          <div className="v-screen-title">FRIENDS</div>
          <div className="v-screen-sub">YOUR CONNECTIONS</div>
        </div>
      </div>

      <div className="design-people-tabs" style={{ gridTemplateColumns: '1fr 1fr 1fr 1fr', margin: '0 36px' }}>
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

        {!loading && tab === 'activity' && (
          feedLoading && feed.length === 0
            ? <div className="v-empty">LOADING…</div>
            : feed.length === 0
              ? <div className="v-empty">No recent activity from friends yet.</div>
              : <>
                {feed.slice(0, feedShown).map(ev => {
                  const a = friendsMap[ev.actorId];
                  return (
                    <div key={ev.key} className="feed-row">
                      <Avatar url={a?.avatar_url} frame={a?.equipped_frame} size={40} />
                      <div className="feed-info">
                        <div className="feed-line">
                          <Username name={a?.username || 'Someone'} effect={a?.equipped_name_effect} />
                          {ev.type === 'item' && <span className="feed-verb"> added {ev.name}</span>}
                          {ev.type === 'fit' && <span className="feed-verb"> posted a fit — {ev.name}</span>}
                          {ev.type === 'achievement' && <span className="feed-verb"> unlocked {ev.name} · +{ev.xp} XP</span>}
                        </div>
                        <div className="feed-time">{timeAgo(ev.ts)}</div>
                      </div>
                      {ev.image && (ev.type === 'item' || ev.type === 'fit') && (
                        <img className="feed-thumb" src={ev.image} alt="" loading="lazy" />
                      )}
                      {ev.type === 'fit' && (
                        <FitLikeButton key={`${ev.postId}-${ev.likeCount}-${ev.likedByMe}`}
                          postId={ev.postId} user={user} initialCount={ev.likeCount} initialLiked={ev.likedByMe} />
                      )}
                    </div>
                  );
                })}
                {feed.length > feedShown && (
                  <button className="design-action-btn" style={{ display: 'block', margin: '16px auto 0' }}
                    onClick={() => setFeedShown(n => n + 10)}>LOAD MORE</button>
                )}
              </>
        )}

        {!loading && tab === 'friends' && (
          friends.length === 0
            ? <div className="v-empty">No friends yet — find people in Explore.</div>
            : friends.map(f => {
              const stats = itemStats[f.id];
              return (
                <div key={f.id} className="design-people-row" style={{ cursor: 'pointer' }} onClick={() => onViewProfile(f)}>
                  <Avatar url={f.avatar_url} frame={f.equipped_frame} />
                  <div className="design-people-info">
                    <div className="design-people-name"><Username name={f.username || 'Anonymous'} effect={f.equipped_name_effect} /></div>
                    {f.location && <div className="design-people-location">{f.location.toUpperCase()}</div>}
                  </div>
                  {stats && <div className="design-people-stats">{fmtStats(stats.count, stats.value)}</div>}
                  <div className="design-people-actions" onClick={e => e.stopPropagation()}>
                    {onMessage && <button className="design-action-btn active" onClick={() => onMessage(f.id)}>MESSAGE</button>}
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
                    <Avatar url={r.profile?.avatar_url} frame={r.profile?.equipped_frame} />
                    <div className="design-people-info">
                      <div className="design-people-name"><Username name={r.profile?.username || 'Anonymous'} effect={r.profile?.equipped_name_effect} /></div>
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
                    <Avatar url={r.profile?.avatar_url} frame={r.profile?.equipped_frame} />
                    <div className="design-people-info">
                      <div className="design-people-name"><Username name={r.profile?.username || 'Anonymous'} effect={r.profile?.equipped_name_effect} /></div>
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
                <Avatar url={l.profile?.avatar_url} frame={l.profile?.equipped_frame} />
                <div className="design-people-info">
                  <div className="design-people-name"><Username name={l.profile?.username || 'Anonymous'} effect={l.profile?.equipped_name_effect} /></div>
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
