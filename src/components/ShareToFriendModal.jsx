import { useState, useEffect } from 'react';
import { sb } from '../lib/supabase';
import Avatar from './Avatar';
import Username from './Username';

// Picks an accepted friend to share a fit/article into chat with.
export default function ShareToFriendModal({ user, onShare, onClose }) {
  const [friends, setFriends] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy]       = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: acc } = await sb.from('friend_requests')
        .select('from_user_id, to_user_id')
        .or(`from_user_id.eq.${user.id},to_user_id.eq.${user.id}`).eq('status', 'accepted');
      const ids = [...new Set((acc || []).map(r => r.from_user_id === user.id ? r.to_user_id : r.from_user_id))];
      let profs = [];
      if (ids.length) {
        const { data } = await sb.from('profiles')
          .select('id, username, avatar_url, equipped_frame, equipped_name_effect').in('id', ids);
        profs = data || [];
      }
      if (!cancelled) { setFriends(profs); setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [user]);

  async function pick(fid) {
    if (busy) return;
    setBusy(true);
    await onShare(fid);
    onClose();
  }

  return (
    <div className="modal-bg open" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h2>SHARE WITH…</h2>
        {loading && <div className="v-empty">Loading…</div>}
        {!loading && friends.length === 0 && <div className="v-empty">Add friends first to share.</div>}
        {friends.map(f => (
          <div key={f.id} className="design-people-row" style={{ cursor: 'pointer' }} onClick={() => pick(f.id)}>
            <Avatar url={f.avatar_url} frame={f.equipped_frame} size={40} />
            <div className="design-people-info">
              <div className="design-people-name"><Username name={f.username || 'Anonymous'} effect={f.equipped_name_effect} /></div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
