import { useState, useEffect, useRef } from 'react';
import { sb } from '../lib/supabase';
import { maybeConvertHeic } from '../lib/imageUtils';
import { STORAGE } from '../lib/constants';

const PROFILE_KEYS = ['p-name', 'p-fav-brand', 'p-location', 'p-bio'];

async function resizeImage(file, maxSize = 400) {
  return new Promise(resolve => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const size = Math.min(img.width, img.height);
      const sx   = (img.width  - size) / 2;
      const sy   = (img.height - size) / 2;
      const canvas = document.createElement('canvas');
      canvas.width  = maxSize;
      canvas.height = maxSize;
      canvas.getContext('2d').drawImage(img, sx, sy, size, size, 0, 0, maxSize, maxSize);
      URL.revokeObjectURL(url);
      canvas.toBlob(blob => resolve(blob || file), 'image/jpeg', 0.9);
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(file); };
    img.src = url;
  });
}

export default function ProfilePanel({ open, user, onClose, onSignOut, avatarUrl, onAvatarChange }) {
  const [profile, setProfile]     = useState({});
  const [isPublic, setIsPublic]   = useState(false);
  const [saveError, setSaveError] = useState('');
  const [uploading, setUploading] = useState(false);
  const storageKey = `garderobe-profile-${user?.id || 'guest'}`;
  const fileInputRef = useRef(null);

  function tryLocalProfile(key) {
    try { return JSON.parse(localStorage.getItem(key) || '{}'); } catch { return {}; }
  }

  useEffect(() => {
    if (!open) return;
    if (user) {
      sb.auth.getUser().then(({ data: { user: u } }) => {
        const meta = u?.user_metadata?.profile || {};
        setProfile(Object.keys(meta).length ? meta : tryLocalProfile(storageKey));
      });
      sb.from('profiles').select('is_public').eq('id', user.id).maybeSingle()
        .then(({ data }) => { if (data) setIsPublic(data.is_public ?? false); });
    } else {
      setProfile(tryLocalProfile(storageKey));
    }
  }, [open, user, storageKey]);

  function set(key, val) { setProfile(p => ({ ...p, [key]: val })); }

  async function save() {
    const cleaned = {};
    PROFILE_KEYS.forEach(k => { cleaned[k] = (profile[k] || '').trim(); });
    setSaveError('');
    if (user) {
      const { error } = await sb.auth.updateUser({ data: { profile: cleaned } });
      if (error) { setSaveError('Failed to save profile.'); return; }
      await sb.from('profiles').upsert({
        id:         user.id,
        username:   cleaned['p-name']     || null,
        bio:        cleaned['p-bio']      || null,
        location:   cleaned['p-location'] || null,
        avatar_url: avatarUrl             || null,
        is_public:  isPublic,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'id' });
    } else {
      localStorage.setItem(storageKey, JSON.stringify(cleaned));
    }
    onClose();
  }

  async function handleAvatarUpload(e) {
    const raw = e.target.files[0]; if (!raw) return;
    e.target.value = '';
    setSaveError(''); setUploading(true);
    try {
      const converted = await maybeConvertHeic(raw);
      const resized   = await resizeImage(converted);
      const path = `${user.id}/avatar.jpg`;
      await sb.storage.from('images').remove([path]);
      const { error } = await sb.storage.from('images').upload(path, resized, { contentType: 'image/jpeg' });
      if (error) { console.error('Avatar upload error:', error); setSaveError(`Upload failed: ${error.message}`); return; }
      const url = `${STORAGE}/images/${path}?t=${Date.now()}`;
      await sb.auth.updateUser({ data: { profile: { ...profile, avatarUrl: url } } });
      onAvatarChange(url);
    } finally {
      setUploading(false);
    }
  }

  return (
    <>
      <div className={`profile-overlay${open ? ' open' : ''}`} onClick={onClose} />
      <div className={`profile-panel${open ? ' open' : ''}`}>
        <button className="profile-close" onClick={onClose}>×</button>
        <h2>PROFILE</h2>

        <div className="profile-avatar-wrap">
          <div className="profile-avatar-circle" onClick={() => fileInputRef.current?.click()} style={{ cursor: 'pointer' }}>
            {avatarUrl
              ? <img src={avatarUrl} alt="avatar" />
              : <svg width="36" height="36" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4.4 3.6-8 8-8s8 3.6 8 8"/></svg>
            }
            <div className="avatar-overlay">{uploading ? '...' : '+'}</div>
          </div>
          <input ref={fileInputRef} type="file" accept="image/*,.heic,.heif" onChange={handleAvatarUpload} style={{ display: 'none' }} />
          <span style={{ fontSize: 10, color: '#aaa', marginTop: 4, letterSpacing: '0.06em' }}>TAP TO CHANGE</span>
        </div>

        <div className="profile-field"><label>NAME</label><input value={profile['p-name'] || ''} onChange={e => set('p-name', e.target.value)} placeholder="Your name" /></div>
        <div className="profile-field"><label>FAVORITE BRAND</label><input value={profile['p-fav-brand'] || ''} onChange={e => set('p-fav-brand', e.target.value)} placeholder="e.g. Maison Margiela" /></div>
        <div className="profile-field"><label>LOCATION</label><input value={profile['p-location'] || ''} onChange={e => set('p-location', e.target.value)} placeholder="e.g. Tokyo, London" /></div>
        <div className="profile-field"><label>BIO</label><textarea rows="3" value={profile['p-bio'] || ''} onChange={e => set('p-bio', e.target.value)} placeholder="A few words about your style..." /></div>

        <div className="profile-section-label">DISCOVERY</div>
        <label className="profile-public-toggle">
          <div className={`toggle-track${isPublic ? ' on' : ''}`} onClick={() => setIsPublic(v => !v)}>
            <div className="toggle-thumb" />
          </div>
          <span>{isPublic ? 'PUBLIC — visible in Explore' : 'PRIVATE — only you can see this'}</span>
        </label>

        {saveError && <div className="auth-error" style={{ marginBottom: 8 }}>{saveError}</div>}
        <button className="profile-save-btn" onClick={save}>SAVE CHANGES</button>
        <div className="profile-user-email">{user?.email || ''}</div>
        <button className="profile-signout-btn" onClick={onSignOut}>SIGN OUT</button>
      </div>
    </>
  );
}
