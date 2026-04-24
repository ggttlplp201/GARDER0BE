import { useEffect, useState, useCallback } from 'react';
import { useAuth } from './hooks/useAuth';
import { useTheme } from './hooks/useTheme';
import { useItems } from './hooks/useItems';
import AuthScreen from './components/AuthScreen';
import AppHeader from './components/AppHeader';
import AppNav from './components/AppNav';
import WardrobeView from './components/WardrobeView';
import ItemDetailView from './components/ItemDetailView';
import TimelineView from './components/TimelineView';
import WishlistView from './components/WishlistView';
import OutfitsView from './components/OutfitsView';
import ExplorePage from './components/ExplorePage';
import FriendsPage from './components/FriendsPage';
import ProfilePanel from './components/ProfilePanel';
import AddItemModal from './components/AddItemModal';
import EditItemModal from './components/EditItemModal';
import Lightbox from './components/Lightbox';
import { requestGyroPermission } from './lib/gyro';
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

export default function App() {
  const { user, authMode, setAuthMode, signIn, signUp, signOut } = useAuth();
  const { dark, toggle: toggleTheme } = useTheme();
  const { items, loading, fetchItems, addItem, editItem, removeItem } = useItems(user);

  const [page, setPage]               = useState(() => sessionStorage.getItem('garderobe-page') || 'wardrobe');
  const [detailItem, setDetailItem]   = useState(null);
  const [total, setTotal]             = useState(0);
  const [profileOpen, setProfileOpen] = useState(false);
  const [avatarUrl, setAvatarUrl]     = useState('');
  const [userLocation, setUserLocation] = useState('');
  const [userName, setUserName]       = useState('');
  const [addOpen, setAddOpen]         = useState(false);
  const [editItemId, setEditItemId]   = useState(null);
  const [lbItem, setLbItem]           = useState(null);
  const [requestCount, setRequestCount] = useState(0);
  const [likeCount, setLikeCount]     = useState(0);
  const [friendsProfile, setFriendsProfile] = useState(null);
  const [toasts, setToasts]           = useState([]);

  useEffect(() => {
    if (!window.DeviceOrientationEvent) return;
    document.addEventListener('click', requestGyroPermission);
    return () => document.removeEventListener('click', requestGyroPermission);
  }, []);

  useEffect(() => {
    if (user) fetchItems();
  }, [user, fetchItems]);

  useEffect(() => {
    const t = items.filter(i => i.status !== 'wishlist').reduce((s, i) => s + (parseFloat(i.price) || 0), 0);
    setTotal(Math.round(t));
  }, [items]);

  useEffect(() => {
    setAvatarUrl('');
    setUserLocation('');
    setUserName('');
    if (!user) return;
    const key = `garderobe-profile-${user.id}`;
    try {
      const p = JSON.parse(localStorage.getItem(key) || '{}');
      if (p.avatarUrl) setAvatarUrl(p.avatarUrl);
      if (p['p-location']) setUserLocation(p['p-location']);
      if (p['p-name']) setUserName(p['p-name']);
    } catch {}
    sb.auth.getUser().then(({ data: { user: u } }) => {
      const meta = u?.user_metadata?.profile || {};
      if (meta.avatarUrl) setAvatarUrl(meta.avatarUrl);
      if (meta['p-location']) setUserLocation(meta['p-location']);
      if (meta['p-name']) setUserName(meta['p-name']);
    });
  }, [user?.id]);

  useEffect(() => {
    if (!user) return;
    pollRequests(user.id, setRequestCount);
  }, [user]);

  useEffect(() => {
    if (!user) return;
    const channel = sb.channel('profile-likes-' + user.id)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'profile_likes', filter: `liked_user_id=eq.${user.id}` }, async (payload) => {
        const { data: profile } = await sb.from('profiles').select('username, avatar_url').eq('id', payload.new.user_id).maybeSingle();
        const toast = { id: Date.now(), name: profile?.username || 'Someone', avatarUrl: profile?.avatar_url || null };
        setToasts(t => [...t, toast]);
        setLikeCount(c => c + 1);
        setTimeout(() => setToasts(t => t.filter(x => x.id !== toast.id)), 5000);
      })
      .subscribe();
    return () => sb.removeChannel(channel);
  }, [user]);

  const dismissToast = useCallback(id => setToasts(t => t.filter(x => x.id !== id)), []);

  const navigate = useCallback((p) => {
    sessionStorage.setItem('garderobe-page', p);
    setPage(p);
  }, []);

  const handleItemClick = useCallback((item) => {
    setDetailItem(item);
    navigate('detail');
  }, [navigate]);

  const handleBack = useCallback(() => {
    navigate('wardrobe');
    setDetailItem(null);
  }, [navigate]);

  const handleNavigateDetail = useCallback((item) => {
    setDetailItem(item);
  }, []);

  const handleViewFriendProfile = (profile) => {
    setFriendsProfile(profile);
    navigate('explore');
  };

  if (user === undefined) return (
    <div className="app-loading"><span className="app-loading-text">GARDEROBE</span></div>
  );

  if (!user) return (
    <AuthScreen authMode={authMode} setAuthMode={setAuthMode} onLogin={signIn} onSignUp={signUp} />
  );

  const editItemObj = editItemId ? items.find(i => i.id === editItemId) : null;

  return (
    <div className="app-shell">
      <AppHeader
        user={user}
        dark={dark}
        onDark={toggleTheme}
        avatarUrl={avatarUrl}
        location={userLocation}
        userName={userName}
        onProfileOpen={() => setProfileOpen(true)}
      />

      <div className="app-main">
        {page === 'wardrobe' && (
          <WardrobeView
            items={items}
            loading={loading}
            onItemClick={handleItemClick}
            onAdd={() => setAddOpen(true)}
            onEdit={id => setEditItemId(id)}
            onRemove={removeItem}
          />
        )}
        {page === 'detail' && (
          <ItemDetailView
            item={items.find(i => i.id === detailItem?.id) ?? detailItem}
            items={items}
            onBack={handleBack}
            onEdit={id => setEditItemId(id)}
            onNavigate={handleNavigateDetail}
            onOpenLightbox={item => setLbItem(item)}
          />
        )}
        {page === 'outfits' && <OutfitsView items={items} />}
        {page === 'timeline' && <TimelineView items={items} onItemClick={handleItemClick} />}
        {page === 'wishlist' && (
          <WishlistView items={items} onItemClick={handleItemClick} onAdd={() => setAddOpen(true)} />
        )}
        {page === 'explore' && (
          <ExplorePage
            user={user}
            externalProfile={friendsProfile}
            onExternalProfileClear={() => setFriendsProfile(null)}
          />
        )}
        {page === 'friends' && (
          <FriendsPage
            user={user}
            onViewProfile={handleViewFriendProfile}
            onRequestsViewed={() => setRequestCount(0)}
          />
        )}
      </div>

      <AppNav
        page={page}
        setPage={p => {
          navigate(p);
          if (p === 'friends') { setToasts([]); setRequestCount(0); }
          if (p === 'explore') setLikeCount(0);
        }}
        total={total}
        requestCount={requestCount}
        likeCount={likeCount}
      />

      {/* Overlays */}
      <div className={`profile-overlay${profileOpen ? ' open' : ''}`} onClick={() => setProfileOpen(false)} />
      <ProfilePanel
        user={user}
        open={profileOpen}
        onClose={() => setProfileOpen(false)}
        onSignOut={() => { signOut(); setProfileOpen(false); }}
        avatarUrl={avatarUrl}
        onAvatarChange={url => setAvatarUrl(url)}
        onProfileSave={() => {
          sb.auth.getUser().then(({ data: { user: u } }) => {
            const meta = u?.user_metadata?.profile || {};
            if (meta['p-location']) setUserLocation(meta['p-location']);
            if (meta['p-name']) setUserName(meta['p-name']);
            if (meta.avatarUrl) setAvatarUrl(meta.avatarUrl);
          });
        }}
      />

      {addOpen && (
        <AddItemModal
          open={true}
          onClose={() => setAddOpen(false)}
          onAdd={async (fields, imgs) => { await addItem(fields, imgs); setAddOpen(false); }}
        />
      )}
      {editItemObj && (
        <EditItemModal
          item={editItemObj}
          onClose={() => setEditItemId(null)}
          onSave={async (fields, imgs) => { await editItem(editItemObj.id, fields, imgs, editItemObj); setEditItemId(null); }}
        />
      )}
      {lbItem && (
        <Lightbox
          item={lbItem}
          onClose={() => setLbItem(null)}
          onEdit={id => { setLbItem(null); setEditItemId(id); }}
        />
      )}

      <LikeToast toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}

async function pollRequests(userId, setCount) {
  const { count } = await sb.from('friend_requests')
    .select('id', { count: 'exact', head: true })
    .eq('to_user_id', userId).eq('status', 'pending');
  setCount(count || 0);
}
