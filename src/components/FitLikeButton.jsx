import { useState } from 'react';
import { sb } from '../lib/supabase';

// Heart toggle for liking a public fit (outfit_posts). Optimistic; reverts on error.
// Owner XP + Popular achievement are handled server-side by the fit_likes trigger.
export default function FitLikeButton({ postId, user, initialCount = 0, initialLiked = false }) {
  const [count, setCount] = useState(initialCount);
  const [liked, setLiked] = useState(initialLiked);
  const [busy, setBusy]   = useState(false);

  async function toggle(e) {
    e.stopPropagation();
    if (!user || busy) return;
    setBusy(true);
    const next = !liked;
    setLiked(next);
    setCount(c => Math.max(0, c + (next ? 1 : -1)));
    const { error } = next
      ? await sb.from('fit_likes').insert({ user_id: user.id, post_id: postId })
      : await sb.from('fit_likes').delete().eq('user_id', user.id).eq('post_id', postId);
    // 23505 = row already exists (stale initialLiked) → the optimistic "liked"
    // state already matches the DB, so don't revert it.
    if (error && error.code !== '23505') { setLiked(!next); setCount(c => Math.max(0, c + (next ? -1 : 1))); }
    setBusy(false);
  }

  return (
    <button className={`fit-like-btn${liked ? ' liked' : ''}`} onClick={toggle} title="Like" aria-label="Like fit">
      <svg width="14" height="14" viewBox="0 0 24 24" fill={liked ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2">
        <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
      </svg>
      {count > 0 && <span>{count}</span>}
    </button>
  );
}
