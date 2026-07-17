import { useEffect, useState } from 'react';
import DesignHouseGlobe from './DesignHouseGlobe';
import { tzAbbrev } from '../lib/geo';
import { getLevelState } from '../lib/levels';

export default function AppHeader({ onDark, avatarUrl, location, userName, onProfileOpen, onViewProfile, gameState, wallet }) {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const dateStr = now.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: '2-digit' }).replace(/\//g, '.');
  const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  const zoneStr = tzAbbrev(null, now);
  const displayLocation = location?.toUpperCase() || Intl.DateTimeFormat().resolvedOptions().timeZone?.split('/').pop()?.replace(/_/g, ' ').toUpperCase() || 'LOCAL';
  const lvl = gameState ? getLevelState(gameState.total_xp) : null;

  return (
    <div className="app-header">
      <div className="app-header-left">
        <div className="app-wordmark">GARDEROBE</div>
        <div className="app-phonetic">/ ɡärd ˌrōb /</div>
        <div className="app-subtitle">your digital wardrobe for all your grails</div>
      </div>
      <div className="app-header-right">
        <div className="app-header-meta-col">
          <div className="app-header-meta">
            <div>ISSUE 04 · VOL. XXVI</div>
            <div>{(userName || 'DEMO').toUpperCase()} · {displayLocation}</div>
            <div>{dateStr} · {timeStr}{zoneStr ? ` ${zoneStr}` : ''}</div>
            {lvl && (
              <div className="app-header-lvl">
                LVL {lvl.level} · {lvl.xpIntoLevel}/{lvl.xpForNextLevel} XP{wallet ? ` · ${wallet.coins.toLocaleString()} ¢` : ''}
              </div>
            )}
          </div>
          {lvl && (
            <div className="app-xp-bar" aria-label={`Level ${lvl.level} progress`}>
              <div className="app-xp-fill" style={{ width: `${lvl.pct}%` }} />
            </div>
          )}
        </div>
        <div className="app-globe-slot">
          <DesignHouseGlobe mini onViewProfile={onViewProfile} myLocation={location} />
        </div>
        <div className="app-header-controls">
          <button className="app-avatar-btn" onClick={onProfileOpen} aria-label="Profile">
            {avatarUrl ? <img src={avatarUrl} alt="Profile" /> : null}
          </button>
          <button className="app-dark-btn" onClick={onDark} aria-label="Toggle dark mode">☾</button>
        </div>
      </div>
    </div>
  );
}
