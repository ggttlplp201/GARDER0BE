import { useState } from 'react';
import { getLevelState } from '../lib/levels';
import { FRAMES, NAME_EFFECTS } from '../lib/cosmetics';
import Avatar from './Avatar';
import Username from './Username';
import CoinIcon from './CoinIcon';

const QUEST_LABELS = {
  log_wear: 'LOG A WEAR', add_item: 'ADD AN ITEM', save_outfit: 'SAVE AN OUTFIT',
  like_profile: 'LIKE A PROFILE', browse_explore: 'BROWSE EXPLORE',
};

function Bar({ pct }) {
  return (
    <div className="stats-bar"><div className="stats-bar-fill" style={{ width: `${pct}%` }} /></div>
  );
}

// ── Shop ──────────────────────────────────────────────────────────────────

function ShopCard({ c, game, level, coins, busy, onBuy, onEquip }) {
  const isFrame = c.type === 'frame';
  const owned = c.id === 'thin_line' || game.ownedCosmetics.has(c.id);
  const equippedId = isFrame ? (game.equipped.frame || 'thin_line') : game.equipped.name_effect;
  const isEquipped = c.id === equippedId;

  let btn;
  if (owned) {
    btn = isEquipped
      ? <button className="shop-btn" disabled>EQUIPPED</button>
      : <button className="shop-btn active" disabled={busy} onClick={() => onEquip(c)}>EQUIP</button>;
  } else if (level < c.minLevel) {
    btn = <button className="shop-btn" disabled>LVL {c.minLevel}</button>;
  } else if (coins < c.price) {
    btn = <button className="shop-btn" disabled>NEED COINS</button>;
  } else {
    btn = <button className="shop-btn active" disabled={busy} onClick={() => onBuy(c)}>BUY</button>;
  }

  return (
    <div className={`shop-card${isEquipped ? ' equipped' : ''}`}>
      <div className="shop-card-preview">
        {isFrame
          ? <Avatar url={null} frame={c.id} size={56} />
          : <Username name="ABCDEF" effect={c.id} className="shop-fx-sample" />}
      </div>
      <div className="shop-card-name">{c.name.toUpperCase()}</div>
      <div className="shop-card-price">
        {c.price === 0 ? 'FREE' : <>{c.price.toLocaleString()} <CoinIcon size={10} /></>}
      </div>
      {btn}
    </div>
  );
}

function Shop({ game, level, coins }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const onBuy = async (c) => {
    setBusy(true); setError('');
    const { error } = await game.buyCosmetic(c.id);
    if (error) setError(error.message || 'Purchase failed.');
    setBusy(false);
  };
  const onEquip = async (c) => {
    setBusy(true); setError('');
    const { error } = await game.equipCosmetic(c.id, c.type);
    if (error) setError(error.message || 'Equip failed.');
    setBusy(false);
  };

  const frameEquipped = game.equipped.frame || 'thin_line';
  return (
    <>
      <div className="friends-section-label" style={{ marginTop: 24 }}>LOADOUT</div>
      <div className="shop-loadout">
        <Avatar url={null} frame={frameEquipped} size={44} />
        <div className="shop-loadout-info">
          <Username name="YOUR NAME" effect={game.equipped.name_effect} className="shop-loadout-name" />
          <div className="shop-loadout-actions">
            {frameEquipped !== 'thin_line' &&
              <button className="shop-mini-btn" disabled={busy} onClick={() => game.unequip('frame')}>REMOVE FRAME</button>}
            {game.equipped.name_effect &&
              <button className="shop-mini-btn" disabled={busy} onClick={() => game.unequip('name_effect')}>REMOVE EFFECT</button>}
            {frameEquipped === 'thin_line' && !game.equipped.name_effect &&
              <span className="shop-loadout-hint">Buy &amp; equip cosmetics below.</span>}
          </div>
        </div>
      </div>

      {error && <div className="shop-error">{error}</div>}

      <div className="friends-section-label" style={{ marginTop: 20 }}>FRAMES</div>
      <div className="shop-grid">
        {FRAMES.map(c => <ShopCard key={c.id} c={c} game={game} level={level} coins={coins} busy={busy} onBuy={onBuy} onEquip={onEquip} />)}
      </div>

      <div className="friends-section-label" style={{ marginTop: 20 }}>NAME EFFECTS</div>
      <div className="shop-grid">
        {NAME_EFFECTS.map(c => <ShopCard key={c.id} c={c} game={game} level={level} coins={coins} busy={busy} onBuy={onBuy} onEquip={onEquip} />)}
      </div>
    </>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────

export default function StatsPage({ game }) {
  const { gameState, wallet, quests, defs, achievements } = game;
  const lvl = gameState ? getLevelState(gameState.total_xp) : null;
  const coins = wallet?.coins ?? 0;

  return (
    <div className="v-screen">
      <div className="v-screen-header">
        <div>
          <div className="v-screen-title">STATS</div>
          <div className="v-screen-sub">
            {lvl
              ? <>LEVEL {lvl.level} · {gameState.total_xp.toLocaleString()} XP · {coins.toLocaleString()} <CoinIcon size={11} /></>
              : 'LOADING…'}
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
              {q.progress}/{q.goal} · +{q.xp_reward} XP · +{q.coin_reward} <CoinIcon size={9} />
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

        <Shop game={game} level={lvl?.level ?? 1} coins={coins} />
      </div>
    </div>
  );
}
