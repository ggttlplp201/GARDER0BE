import { useEffect, useState } from 'react';
import DesignHouseGlobe from './DesignHouseGlobe';

export default function AppHeader({ user, dark, onDark, avatarUrl, location, userName, onProfileOpen }) {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(id);
  }, []);

  const dateStr = now.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: '2-digit' }).replace(/\//g, '.');
  const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
  const displayLocation = location?.toUpperCase() || Intl.DateTimeFormat().resolvedOptions().timeZone?.split('/').pop()?.replace(/_/g, ' ').toUpperCase() || 'LOCAL';

  return (
    <div className="app-header">
      <div className="app-header-left">
        <div className="app-wordmark">GARDEROBE</div>
        <div className="app-phonetic">/ ɡärd ˌrōb /</div>
        <div className="app-subtitle">your digital wardrobe for all your grails</div>
      </div>
      <div className="app-header-right">
        <div className="app-header-meta">
          <div>ISSUE 04 · VOL. XXVI</div>
          <div>{(userName || 'DEMO').toUpperCase()} · {displayLocation}</div>
          <div>{dateStr} · {timeStr}</div>
        </div>
        <div className="app-globe-slot">
          <DesignHouseGlobe mini />
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
