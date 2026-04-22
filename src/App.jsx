import { useEffect, useState, useCallback } from 'react';
import { useAuth } from './hooks/useAuth';
import AuthScreen from './components/AuthScreen';
import Inventory from './components/Inventory';
import ExplorePage from './components/ExplorePage';
import FriendsPage from './components/FriendsPage';
import { enableGyro } from './lib/gyro';
import { sb } from './lib/supabase';
import './App.css';

function LikeToast({ toasts, onDismiss }) {
  if (!toasts.length) return null;
  return (
    <div className="toast-stack">
      {toasts.map(t => (
        <div key={t.id} className="like-toast" onClick={() => onDismiss(t.id)}>
          {t.avatarUrl
            ? <img src={t.avatarUrl} alt="" className="like-toast-avatar" />
            : <div className="like-toast-avatar like-toast-avatar-placeholder" />
          }
          <div className="like-toast-text">
            <span className="like-toast-name">{t.name}</span>
            <span className="like-toast-msg"> liked your profile</span>
          </div>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" style={{ color: '#e05', flexShrink: 0 }}>
            <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
          </svg>
        </div>
      ))}
    </div>
  );
}

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
        <button className={`bottom-nav-tab${page === 'inventory' ? ' active' : ''}`} onClick={() => onNavigate('inventory')}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/>
          </svg>
          <span>WARDROBE</span>
        </button>
        <button className={`bottom-nav-tab${page === 'explore' ? ' active' : ''}`} onClick={() => onNavigate('explore')}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
          </svg>
          <span>EXPLORE</span>
        </button>
        <button className={`bottom-nav-tab${page === 'friends' ? ' active' : ''}`} onClick={() => onNavigate('friends')}>
          <div style={{ position: 'relative', display: 'inline-flex' }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>
              <path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
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
  const [page, setPage]                 = useState('inventory');
  const [total, setTotal]               = useState(0);
  const [requestCount, setRequestCount] = useState(0);
  const [friendsProfile, setFriendsProfile] = useState(null);
  const [toasts, setToasts]             = useState([]);

  useEffect(() => {
    if (!window.DeviceOrientationEvent) return;
    async function tryEnable() {
      const status = await enableGyro();
      if (status !== 'denied') document.removeEventListener('pointerdown', tryEnable);
    }
    document.addEventListener('pointerdown', tryEnable);
    return () => document.removeEventListener('pointerdown', tryEnable);
  }, []);

  useEffect(() => {
    if (!user) return;
    pollRequests(user.id, setRequestCount);
  }, [user]);

  const dismissToast = useCallback(id => {
    setToasts(t => t.filter(x => x.id !== id));
  }, []);

  // Realtime subscription for new likes
  useEffect(() => {
    if (!user) return;
    const channel = sb.channel('profile-likes-' + user.id)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'profile_likes',
        filter: `liked_user_id=eq.${user.id}`,
      }, async (payload) => {
        const fromId = payload.new.user_id;
        const { data: profile } = await sb.from('profiles').select('username, avatar_url').eq('id', fromId).maybeSingle();
        const toast = {
          id: Date.now(),
          name: profile?.username || 'Someone',
          avatarUrl: profile?.avatar_url || null,
        };
        setToasts(t => [...t, toast]);
        setTimeout(() => setToasts(t => t.filter(x => x.id !== toast.id)), 5000);
      })
      .subscribe();
    return () => sb.removeChannel(channel);
  }, [user]);

  if (user === undefined) return (
    <div className="app-loading"><span className="app-loading-text">GARDEROBE</span></div>
  );

  if (!user) return (
    <AuthScreen authMode={authMode} setAuthMode={setAuthMode} onLogin={signIn} onSignUp={signUp} />
  );

  function handleViewFriendProfile(profile) {
    setFriendsProfile(profile);
    setPage('explore');
  }

  return (
    <>
      {page === 'inventory' && <Inventory user={user} onSignOut={signOut} onTotalChange={setTotal} />}
      {page === 'explore'   && <ExplorePage user={user} externalProfile={friendsProfile} onExternalProfileClear={() => setFriendsProfile(null)} />}
      {page === 'friends'   && <FriendsPage user={user} onViewProfile={handleViewFriendProfile} onRequestsViewed={() => setRequestCount(0)} />}
      <BottomNav page={page} onNavigate={p => { setPage(p); if (p === 'friends') setToasts([]); }} total={total} showTotal={page === 'inventory' && total > 0} requestCount={requestCount} />
      <LikeToast toasts={toasts} onDismiss={dismissToast} />
    </>
  );
}

async function pollRequests(userId, setCount) {
  const { count } = await sb.from('friend_requests')
    .select('id', { count: 'exact', head: true })
    .eq('to_user_id', userId).eq('status', 'pending');
  setCount(count || 0);
}
