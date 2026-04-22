import { useEffect, useState } from 'react';
import { useAuth } from './hooks/useAuth';
import AuthScreen from './components/AuthScreen';
import Inventory from './components/Inventory';
import ExplorePage from './components/ExplorePage';
import { enableGyro } from './lib/gyro';
import './App.css';

function BottomNav({ page, onNavigate, total, showTotal }) {
  return (
    <div className="bottom-nav">
      {showTotal && (
        <div className="bottom-nav-total">
          <span>COLLECTION VALUE</span>
          <span>${total.toLocaleString()}</span>
        </div>
      )}
      <div className="bottom-nav-tabs">
        <button
          className={`bottom-nav-tab${page === 'inventory' ? ' active' : ''}`}
          onClick={() => onNavigate('inventory')}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="2" y="3" width="20" height="14" rx="2"/>
            <path d="M8 21h8M12 17v4"/>
          </svg>
          <span>WARDROBE</span>
        </button>
        <button
          className={`bottom-nav-tab${page === 'explore' ? ' active' : ''}`}
          onClick={() => onNavigate('explore')}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8"/>
            <path d="m21 21-4.35-4.35"/>
          </svg>
          <span>EXPLORE</span>
        </button>
      </div>
    </div>
  );
}

export default function App() {
  const { user, authMode, setAuthMode, signIn, signUp, signOut } = useAuth();
  const [page, setPage]   = useState('inventory');
  const [total, setTotal] = useState(0);

  useEffect(() => {
    if (!('ontouchstart' in window)) return;
    document.addEventListener('touchstart', enableGyro, { once: true, passive: true });
    return () => document.removeEventListener('touchstart', enableGyro);
  }, []);

  if (user === undefined) return (
    <div className="app-loading">
      <span className="app-loading-text">GARDEROBE</span>
    </div>
  );

  if (!user) {
    return (
      <AuthScreen
        authMode={authMode}
        setAuthMode={setAuthMode}
        onLogin={signIn}
        onSignUp={signUp}
      />
    );
  }

  return (
    <>
      {page === 'inventory'
        ? <Inventory user={user} onSignOut={signOut} onTotalChange={setTotal} />
        : <ExplorePage />
      }
      <BottomNav
        page={page}
        onNavigate={setPage}
        total={total}
        showTotal={page === 'inventory' && total > 0}
      />
    </>
  );
}
