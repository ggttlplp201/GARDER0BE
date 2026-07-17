import { getLevelState } from '../lib/levels';

const QUEST_LABELS = {
  log_wear: 'LOG A WEAR', add_item: 'ADD AN ITEM', save_outfit: 'SAVE AN OUTFIT',
  like_profile: 'LIKE A PROFILE', browse_explore: 'BROWSE EXPLORE',
};

function Bar({ pct }) {
  return (
    <div className="stats-bar"><div className="stats-bar-fill" style={{ width: `${pct}%` }} /></div>
  );
}

export default function StatsPage({ game }) {
  const { gameState, wallet, quests, defs, achievements } = game;
  const lvl = gameState ? getLevelState(gameState.total_xp) : null;

  return (
    <div className="v-screen">
      <div className="v-screen-header">
        <div>
          <div className="v-screen-title">STATS</div>
          <div className="v-screen-sub">
            {lvl ? `LEVEL ${lvl.level} · ${gameState.total_xp.toLocaleString()} XP · ${(wallet?.coins ?? 0).toLocaleString()} ¢` : 'LOADING…'}
          </div>
        </div>
      </div>

      <div className="v-body" style={{ padding: '0 36px 24px' }}>
        <div className="friends-section-label">TODAY'S QUESTS</div>
        {quests.length === 0 && <div className="v-empty">No quests rolled yet — check back after your first open today.</div>}
        {quests.map(q => (
          <div key={q.id} className="stats-quest-row">
            <div className="stats-quest-info">
              <div className="stats-quest-name">
                {QUEST_LABELS[q.quest_type] || q.quest_type.toUpperCase()}
                {q.completed_at && ' ✓'}
              </div>
              <Bar pct={Math.round((q.progress / q.goal) * 100)} />
            </div>
            <div className="stats-quest-reward">
              {q.progress}/{q.goal} · +{q.xp_reward} XP · +{q.coin_reward} ¢
            </div>
          </div>
        ))}

        <div className="friends-section-label" style={{ marginTop: 24 }}>STREAK</div>
        <div className="stats-streak">
          {gameState ? `${gameState.streak_count} DAY${gameState.streak_count === 1 ? '' : 'S'} · BEST ${gameState.best_streak}` : '—'}
        </div>

        <div className="friends-section-label" style={{ marginTop: 24 }}>ACHIEVEMENTS</div>
        <div className="stats-ach-grid">
          {defs.map(d => {
            const ua = achievements[d.id];
            const unlocked = !!ua?.unlocked_at;
            const progress = ua?.progress ?? 0;
            return (
              <div key={d.id} className={`stats-ach${unlocked ? ' unlocked' : ''}`}>
                <div className="stats-ach-name">{d.name.toUpperCase()}</div>
                <div className="stats-ach-desc">{d.description}</div>
                {unlocked
                  ? <div className="stats-ach-meta">
                      {new Date(ua.unlocked_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).toUpperCase()} · +{d.xp} XP
                    </div>
                  : <>
                      <Bar pct={Math.round((progress / d.goal) * 100)} />
                      <div className="stats-ach-meta">{progress}/{d.goal} · +{d.xp} XP</div>
                    </>
                }
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
