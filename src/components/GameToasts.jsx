import { useEffect } from 'react';

const REASON_LABELS = {
  wear_logged: 'WEAR LOGGED', item_added: 'ITEM ADDED', outfit_saved: 'OUTFIT SAVED',
  daily_open: 'DAILY CHECK-IN', friend_accepted: 'FRIEND ADDED', like_received: 'LIKE RECEIVED',
};
const QUEST_LABELS = {
  log_wear: 'LOG A WEAR', add_item: 'ADD AN ITEM', save_outfit: 'SAVE AN OUTFIT',
  like_profile: 'LIKE A PROFILE', browse_explore: 'BROWSE EXPLORE',
};

function label(ev, defs) {
  if (ev.reason.startsWith('achievement:')) {
    const def = defs.find(d => d.id === ev.reason.slice('achievement:'.length));
    return `ACHIEVEMENT — ${(def?.name || 'UNLOCKED').toUpperCase()}`;
  }
  if (ev.reason.startsWith('quest:')) {
    return `QUEST COMPLETE — ${QUEST_LABELS[ev.reason.slice('quest:'.length)] || 'DONE'}`;
  }
  return REASON_LABELS[ev.reason] || ev.reason.replace(/_/g, ' ').toUpperCase();
}

// Drains the FIFO queue one toast at a time so stacked rewards read cleanly.
export default function GameToasts({ queue, shift, defs }) {
  const current = queue[0] || null;
  useEffect(() => {
    if (!current) return;
    const t = setTimeout(shift, 2600);
    return () => clearTimeout(t);
  }, [current, shift]);
  if (!current) return null;
  const isAchievement = current.reason.startsWith('achievement:');
  return (
    <div className="toast-stack game-toast-stack">
      <div className="like-toast game-toast" onClick={shift}>
        <span className="game-toast-xp">+{current.amount} XP</span>
        <span className={`game-toast-label${isAchievement ? ' achievement' : ''}`}>
          {label(current, defs)}
        </span>
      </div>
    </div>
  );
}
