import { useState, useEffect, useCallback } from 'react';
import { sb } from '../lib/supabase';

export function useGame(user) {
  const [gameState, setGameState]         = useState(null);
  const [wallet, setWallet]               = useState(null);
  const [quests, setQuests]               = useState([]);
  const [defs, setDefs]                   = useState([]);
  const [achievements, setAchievements]   = useState({});
  const [notifications, setNotifications] = useState([]);
  const [levelUp, setLevelUp]             = useState(null);

  const loadAchievements = useCallback(async () => {
    if (!user) return;
    const [{ data: ad }, { data: ua }] = await Promise.all([
      sb.from('achievement_defs').select('*').order('sort'),
      sb.from('user_achievements').select('*').eq('user_id', user.id),
    ]);
    setDefs(ad || []);
    const map = {};
    (ua || []).forEach(r => { map[r.achievement_id] = r; });
    setAchievements(map);
  }, [user]);

  // Light refresh: state + wallet + today's quests (no daily-open side effects)
  const refresh = useCallback(async () => {
    if (!user) return;
    const today = new Date().toISOString().slice(0, 10);
    const [{ data: gs }, { data: w }, { data: q }] = await Promise.all([
      sb.from('game_state').select('*').eq('user_id', user.id).maybeSingle(),
      sb.from('wallets').select('*').eq('user_id', user.id).maybeSingle(),
      sb.from('daily_quests').select('*').eq('user_id', user.id).eq('quest_date', today).order('quest_type'),
    ]);
    if (gs) setGameState(gs);
    if (w) setWallet(w);
    setQuests(q || []);
  }, [user]);

  // Session start: daily open (idempotent) returns full state in one round trip
  useEffect(() => {
    if (!user) {
      setGameState(null); setWallet(null); setQuests([]);
      setNotifications([]); setLevelUp(null);
      return;
    }
    sb.rpc('record_daily_open').then(({ data, error }) => {
      if (error) { console.error(error); refresh(); return; }
      setGameState(data.game_state);
      setWallet(data.wallet);
      setQuests(data.quests || []);
    });
    loadAchievements();
  }, [user, refresh, loadAchievements]);

  // Realtime: every XP event drives toasts, level-up modal, and a state refresh
  useEffect(() => {
    if (!user) return;
    const ch = sb.channel('xp-events-' + user.id)
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'xp_events', filter: `user_id=eq.${user.id}` },
        payload => {
          const ev = payload.new;
          if (ev.reason === 'backfill') return;
          setNotifications(q => [...q, ev]);
          if (ev.leveled_to) setLevelUp(ev);
          refresh();
          if (ev.reason.startsWith('achievement:')) loadAchievements();
        })
      .subscribe();
    return () => sb.removeChannel(ch);
  }, [user, refresh, loadAchievements]);

  const shiftNotification = useCallback(() => setNotifications(q => q.slice(1)), []);
  const clearLevelUp = useCallback(() => setLevelUp(null), []);

  return { gameState, wallet, quests, achievements, defs, notifications, shiftNotification, levelUp, clearLevelUp, refresh };
}
