import { useEffect, useState } from 'react';
import { useAuth } from './hooks/useAuth';
import AuthScreen from './components/AuthScreen';
import Inventory from './components/Inventory';
import ExplorePage from './components/ExplorePage';
import FriendsPage from './components/FriendsPage';
import { enableGyro } from './lib/gyro';
import './App.css';

function BottomNav({ page, onNavigate, total, showTotal, requestCount }) {
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
        <button
          className={`bottom-nav-tab${page === 'friends' ? ' active' : ''}`}
          onClick={() => onNavigate('friends')}
        >
          <div style={{ position: 'relative', display: 'inline-flex' }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
              <circle cx="9" cy="7" r="4"/>
              <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
              <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
            </svg>
            {requestCount > 0 && <span className="nav-badge">{requestCount}</span>}
          </div>
          <span>FRIENDS</span>
        </button>
      </div>
    </div>
  );
}

export default function App() {
  const { user, authMode, setAuthMode, signIn, signUp, signOut } = useAuth();
  const [page, setPage]             = useState('inventory');
  const [total, setTotal]           = useState(0);
  const [requestCount, setRequestCount] = useState(0);
  const [friendsProfile, setFriendsProfile] = useState(null);

  useEffect(() => {
    if (!('ontouchstart' in window)) return;
    document.addEventListener('touchstart', enableGyro, { once: true, passive: true });
    return () => document.removeEventListener('touchstart', enableGyro);
  }, []);

  useEffect(() => {
    if (!user) return;
    sb_pollRequests(user.id, setRequestCount);
  }, [user]);

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

  function handleViewFriendProfile(profile) {
    setFriendsProfile(profile);
    setPage('explore');
  }

  return (
    <>
      {page === 'inventory' && <Inventory user={user} onSignOut={signOut} onTotalChange={setTotal} />}
      {page === 'explore'   && <ExplorePage user={user} externalProfile={friendsProfile} onExternalProfileClear={() => setFriendsProfile(null)} />}
      {page === 'friends'   && <FriendsPage user={user} onViewProfile={handleViewFriendProfile} />}
      <BottomNav
        page={page}
        onNavigate={setPage}
        total={total}
        showTotal={page === 'inventory' && total > 0}
        requestCount={requestCount}
      />
    </>
  );
}

// poll for pending friend request count
async function sb_pollRequests(userId, setCount) {
  const { sb } = await import('./lib/supabase');
  const { count } = await sb.from('friend_requests')
    .select('id', { count: 'exact', head: true })
    .eq('to_user_id', userId).eq('status', 'pending');
  setCount(count || 0);
}
