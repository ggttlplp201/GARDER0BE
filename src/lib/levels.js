// Level curve — MUST stay in parity with xp_to_reach / level_for_xp in
// supabase/migrations/07_gamification.sql
export function xpToReach(level) {
  return level <= 1 ? 0 : 50 * level * (level + 1) - 100;
}

export function getLevelState(totalXp) {
  let level = 1;
  while (xpToReach(level + 1) <= totalXp) level++;
  const base = xpToReach(level);
  const span = xpToReach(level + 1) - base;
  const into = totalXp - base;
  return {
    level,
    xpIntoLevel: into,
    xpForNextLevel: span,
    pct: Math.min(100, Math.round((into / span) * 100)),
  };
}
