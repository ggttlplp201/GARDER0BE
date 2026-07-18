import { useState, useEffect, useCallback, useRef } from 'react';
import { sb } from '../lib/supabase';
import Avatar from './Avatar';
import Username from './Username';
import FitLikeButton from './FitLikeButton';
import ShareToFriendModal from './ShareToFriendModal';

function timeAgo(iso) {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'now';
  if (s < 3600) return Math.floor(s / 60) + 'm';
  if (s < 86400) return Math.floor(s / 3600) + 'h';
  return Math.floor(s / 86400) + 'd';
}

// Instagram-style single-fit view: image, poster, likes, shares, and comments.
export default function FitPostView({ postId, user, onClose, onShareToChat }) {
  const [post, setPost]           = useState(null);
  const [poster, setPoster]       = useState(null);
  const [likeCount, setLikeCount] = useState(0);
  const [likedByMe, setLikedByMe] = useState(false);
  const [shareCount, setShareCount] = useState(0);
  const [comments, setComments]   = useState([]);
  const [text, setText]           = useState('');
  const [loading, setLoading]     = useState(true);
  const [sharing, setSharing]     = useState(false);
  const postRef = useRef(postId);
  useEffect(() => { postRef.current = postId; }, [postId]);

  const load = useCallback(async () => {
    if (!postId) return;
    const pid = postId;
    const { data: p } = await sb.from('outfit_posts').select('*').eq('id', postId).maybeSingle();
    if (postRef.current !== pid) return; // a newer post was opened
    if (!p) { setPost(null); setLoading(false); return; }
    const [{ data: prof }, { count: lc }, { data: mine }, { count: sc }, { data: cm }] = await Promise.all([
      sb.from('profiles').select('id, username, avatar_url, equipped_frame, equipped_name_effect').eq('id', p.user_id).maybeSingle(),
      sb.from('fit_likes').select('*', { count: 'exact', head: true }).eq('post_id', postId),
      user ? sb.from('fit_likes').select('post_id').eq('post_id', postId).eq('user_id', user.id).maybeSingle() : Promise.resolve({ data: null }),
      sb.from('fit_shares').select('*', { count: 'exact', head: true }).eq('post_id', postId),
      sb.from('fit_comments').select('id, user_id, body, created_at').eq('post_id', postId).order('created_at', { ascending: true }),
    ]);
    const ids = [...new Set((cm || []).map(c => c.user_id))];
    const pm = {};
    if (ids.length) {
      const { data: cps } = await sb.from('profiles').select('id, username, avatar_url, equipped_frame, equipped_name_effect').in('id', ids);
      (cps || []).forEach(x => { pm[x.id] = x; });
    }
    if (postRef.current !== pid) return; // superseded during the awaits
    setPost(p); setPoster(prof); setLikeCount(lc || 0); setLikedByMe(!!mine); setShareCount(sc || 0);
    setComments((cm || []).map(c => ({ ...c, profile: pm[c.user_id] || null })));
    setLoading(false);
  }, [postId, user]);

  useEffect(() => { setLoading(true); load(); }, [load]);

  // Live comments
  useEffect(() => {
    if (!postId) return;
    const ch = sb.channel('fit-comments-' + postId)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'fit_comments', filter: `post_id=eq.${postId}` }, load)
      .subscribe();
    return () => sb.removeChannel(ch);
  }, [postId, load]);

  async function submit() {
    const b = text.trim();
    if (!b || !user) return;
    setText('');
    const { error } = await sb.from('fit_comments').insert({ post_id: postId, user_id: user.id, body: b });
    if (!error) load();
  }
  async function delComment(id) {
    setComments(prev => prev.filter(c => c.id !== id));
    const { error } = await sb.from('fit_comments').delete().eq('id', id);
    if (error) load(); // restore if the delete was rejected
  }

  if (!postId) return null;
  return (
    <div className="fitpost-overlay" onClick={onClose}>
      <div className="fitpost" onClick={e => e.stopPropagation()}>
        <button className="fitpost-close" onClick={onClose}>×</button>
        {loading && <div className="fitpost-loading">Loading…</div>}
        {!loading && !post && <div className="fitpost-loading">This fit is no longer available.</div>}
        {!loading && post && (
          <>
            <div className="fitpost-image">
              <img src={post.image_url} alt={post.fit_name} />
            </div>
            <div className="fitpost-side">
              <div className="fitpost-header">
                <Avatar url={poster?.avatar_url} size={40} frame={poster?.equipped_frame} />
                <div className="fitpost-poster">
                  <Username name={poster?.username || 'Anonymous'} effect={poster?.equipped_name_effect} className="fitpost-name" />
                  <div className="fitpost-fitname">{post.fit_name}</div>
                </div>
              </div>
              <div className="fitpost-metaline">{post.slot_count} PIECES · ${Math.round(post.total_value || 0).toLocaleString()} · {timeAgo(post.created_at)}</div>

              <div className="fitpost-actions">
                <FitLikeButton key={`${postId}-${likeCount}-${likedByMe}`} postId={postId} user={user} initialCount={likeCount} initialLiked={likedByMe} />
                <span className="fitpost-stat" title="Comments">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" /></svg>
                  {comments.length}
                </span>
                {onShareToChat && (
                  <button className="fitpost-stat fitpost-sharebtn" onClick={() => setSharing(true)} title="Share">↗ {shareCount}</button>
                )}
              </div>

              <div className="fitpost-comments">
                {comments.length === 0 && <div className="fitpost-empty">No comments yet — be the first.</div>}
                {comments.map(c => (
                  <div key={c.id} className="fitpost-comment">
                    <Avatar url={c.profile?.avatar_url} size={26} frame={c.profile?.equipped_frame} />
                    <div className="fitpost-comment-body">
                      <div>
                        <Username name={c.profile?.username || 'Anonymous'} effect={c.profile?.equipped_name_effect} className="fitpost-comment-name" />
                        <span className="fitpost-comment-text"> {c.body}</span>
                      </div>
                      <div className="fitpost-comment-time">
                        {timeAgo(c.created_at)}
                        {c.user_id === user?.id && <button className="fitpost-comment-del" onClick={() => delComment(c.id)}>delete</button>}
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {user && (
                <div className="fitpost-composer">
                  <input value={text} onChange={e => setText(e.target.value)} maxLength={500}
                    onKeyDown={e => { if (e.key === 'Enter') submit(); }}
                    placeholder="Add a comment…" className="fitpost-input" />
                  <button className="fitpost-postbtn" onClick={submit} disabled={!text.trim()}>POST</button>
                </div>
              )}
            </div>
          </>
        )}
      </div>
      {sharing && post && (
        <ShareToFriendModal
          user={user}
          onClose={() => setSharing(false)}
          onShare={fid => onShareToChat({ type: 'fit', payload: { postId: post.id, image_url: post.image_url, fit_name: post.fit_name } }, fid)}
        />
      )}
    </div>
  );
}
