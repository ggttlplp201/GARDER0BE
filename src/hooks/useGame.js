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
  const [ownedCosmetics, setOwnedCosmetics] = useState(() => new Set());
  const [equipped, setEquipped]           = useState({ frame: null, name_effect: null });

  const fetchCosmetics = useCallback(async () => {
    const [{ data: owned }, { data: prof }] = await Promise.all([
      sb.from('user_cosmetics').select('cosmetic_id').eq('user_id', user.id),
      sb.from('profiles').select('equipped_frame, equipped_name_effect').eq('id', user.id).maybeSingle(),
    ]);
    return {
      owned: new Set((owned || []).map(r => r.cosmetic_id)),
      equipped: { frame: prof?.equipped_frame ?? null, name_effect: prof?.equipped_name_effect ?? null },
    };
  }, [user]);

  const fetchAchievements = useCallback(async () => {
    const [{ data: ad }, { data: ua }] = await Promise.all([
      sb.from('achievement_defs').select('*').order('sort'),
      sb.from('user_achievements').select('*').eq('user_id', user.id),
    ]);
    const map = {};
    (ua || []).forEach(r => { map[r.achievement_id] = r; });
    return { defs: ad || [], map };
  }, [user]);

  // Light fetch: state + wallet + today's quests (no daily-open side effects)
  const fetchGameData = useCallback(async () => {
    const today = new Date().toISOString().slice(0, 10);
    const [{ data: gs }, { data: w }, { data: q }] = await Promise.all([
      sb.from('game_state').select('*').eq('user_id', user.id).maybeSingle(),
      sb.from('wallets').select('*').eq('user_id', user.id).maybeSingle(),
      sb.from('daily_quests').select('*').eq('user_id', user.id).eq('quest_date', today).order('quest_type'),
    ]);
    return { gs, w, q: q || [] };
  }, [user]);

  const refresh = useCallback(async () => {
    if (!user) return;
    const { gs, w, q } = await fetchGameData();
    if (gs) setGameState(gs);
    if (w) setWallet(w);
    setQuests(q);
  }, [user, fetchGameData]);

  useEffect(() => {
    if (!user) {
      setGameState(null); setWallet(null); setQuests([]);
      setDefs([]); setAchievements({});
      setNotifications([]); setLevelUp(null);
      setOwnedCosmetics(new Set()); setEquipped({ frame: null, name_effect: null });
      return;
    }
    let cancelled = false;
    let opened = false;

    fetchAchievements().then(({ defs: ad, map }) => {
      if (cancelled) return;
      setDefs(ad); setAchievements(map);
    });

    fetchCosmetics().then(({ owned, equipped: eq }) => {
      if (cancelled) return;
      setOwnedCosmetics(owned); setEquipped(eq);
    });

    const ch = sb.channel('xp-events-' + user.id)
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'xp_events', filter: `user_id=eq.${user.id}` },
        payload => {
          if (cancelled) return;
          const ev = payload.new;
          if (ev.reason === 'backfill') return;
          setNotifications(q => [...q, ev]);
          if (ev.leveled_to) setLevelUp(ev);
          fetchGameData().then(({ gs, w, q }) => {
            if (cancelled) return;
            if (gs) setGameState(gs);
            if (w) setWallet(w);
            setQuests(q);
          });
          if (ev.reason.startsWith('achievement:')) {
            fetchAchievements().then(({ defs: ad, map }) => {
              if (cancelled) return;
              setDefs(ad); setAchievements(map);
            });
          }
        })
      .subscribe(status => {
        // Daily open runs only once the channel is live, so its XP events reach
        // the toast queue; on subscribe failure fall back so XP is never skipped.
        const ready = status === 'SUBSCRIBED' || status === 'CHANNEL_ERROR' || status === 'TIMED_OUT';
        if (!ready || opened || cancelled) return;
        opened = true;
        sb.rpc('record_daily_open').then(({ data, error }) => {
          if (cancelled) return;
          if (error) { console.error(error); refresh(); return; }
          setGameState(data.game_state);
          setWallet(data.wallet);
          setQuests(data.quests || []);
        });
      });

    return () => { cancelled = true; sb.removeChannel(ch); };
  }, [user, fetchAchievements, fetchGameData, fetchCosmetics, refresh]);

  const shiftNotification = useCallback(() => setNotifications(q => q.slice(1)), []);
  const clearLevelUp = useCallback(() => setLevelUp(null), []);

  // Buy a cosmetic (server validates level/coins/ownership); refresh wallet + owned.
  const buyCosmetic = useCallback(async (id) => {
    const { error } = await sb.rpc('buy_cosmetic', { p_id: id });
    if (!error) {
      const { owned } = await fetchCosmetics();
      setOwnedCosmetics(owned);
      await refresh();
    }
    return { error };
  }, [fetchCosmetics, refresh]);

  // Equip (write the profile column; ownership enforced by DB trigger). type inferred by cosmetic.
  const equipCosmetic = useCallback(async (id, type) => {
    const col = type === 'name_effect' ? 'equipped_name_effect' : 'equipped_frame';
    const { error } = await sb.from('profiles').upsert(
      { id: user.id, [col]: id, updated_at: new Date().toISOString() }, { onConflict: 'id' });
    if (!error) setEquipped(e => ({ ...e, [type === 'name_effect' ? 'name_effect' : 'frame']: id }));
    return { error };
  }, [user]);

  const unequip = useCallback(async (type) => {
    const col = type === 'name_effect' ? 'equipped_name_effect' : 'equipped_frame';
    const { error } = await sb.from('profiles').upsert(
      { id: user.id, [col]: null, updated_at: new Date().toISOString() }, { onConflict: 'id' });
    if (!error) setEquipped(e => ({ ...e, [type === 'name_effect' ? 'name_effect' : 'frame']: null }));
    return { error };
  }, [user]);

  return {
    gameState, wallet, quests, achievements, defs, notifications, shiftNotification,
    levelUp, clearLevelUp, refresh,
    ownedCosmetics, equipped, buyCosmetic, equipCosmetic, unequip,
  };
}
