import { useState, useEffect } from 'react';
import { sb } from '../lib/supabase';
import { maybeConvertHeic } from '../lib/imageUtils';
import { STORAGE } from '../lib/constants';

const PROFILE_KEYS = ['p-name','p-fav-brand','p-fav-designer','p-fav-season',
                      'p-aesthetic','p-size-clothes','p-size-shoes',
                      'p-grail','p-grail-brand','p-grail-budget','p-location','p-bio'];

export default function ProfilePanel({ open, user, onClose, onSignOut, avatarUrl, onAvatarChange }) {
  const [profile, setProfile] = useState({});

  const [saveError, setSaveError] = useState('');
  const storageKey = `garderobe-profile-${user?.id || 'guest'}`;

  useEffect(() => {
    if (!open) return;
    if (user) {
      sb.auth.getUser().then(({ data: { user: u } }) => {
        const meta = u?.user_metadata?.profile || {};
        setProfile(Object.keys(meta).length ? meta : tryLocalProfile(storageKey));
      });
    } else {
      setProfile(tryLocalProfile(storageKey));
    }
  }, [open, user, storageKey]);

  function tryLocalProfile(key) {
    try { return JSON.parse(localStorage.getItem(key) || '{}'); } catch { return {}; }
  }

  function set(key, val) { setProfile(p => ({ ...p, [key]: val })); }

  async function save() {
    const cleaned = {};
    PROFILE_KEYS.forEach(k => { cleaned[k] = (profile[k] || '').trim(); });
    setSaveError('');
    if (user) {
      const { error } = await sb.auth.updateUser({ data: { profile: cleaned } });
      if (error) { setSaveError('Failed to save profile.'); return; }
    } else {
      localStorage.setItem(storageKey, JSON.stringify(cleaned));
    }
    onClose();
  }

  async function handleAvatarUpload(e) {
    const raw = e.target.files[0]; if (!raw) return;
    const file = await maybeConvertHeic(raw);
    const path = `profile/${user.id}/avatar`;
    const { error } = await sb.storage.from('images').upload(path, file, { contentType: file.type, upsert: true });
    if (error) { setSaveError('Avatar upload failed.'); return; }
    const url = `${STORAGE}/images/${path}?t=${Date.now()}`;
    if (user) {
      await sb.auth.updateUser({ data: { profile: { ...profile, avatarUrl: url } } });
    } else {
      const saved = tryLocalProfile(storageKey);
      localStorage.setItem(storageKey, JSON.stringify({ ...saved, avatarUrl: url }));
    }
    onAvatarChange(url);
  }

  return (
    <>
      <div className={`profile-overlay${open ? ' open' : ''}`} onClick={onClose} />
      <div className={`profile-panel${open ? ' open' : ''}`}>
        <button className="profile-close" onClick={onClose}>×</button>
        <h2>PROFILE</h2>
        <div className="profile-avatar-wrap">
          <div className="profile-avatar-circle">
            {avatarUrl
              ? <img src={avatarUrl} alt="avatar" />
              : <svg width="36" height="36" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4.4 3.6-8 8-8s8 3.6 8 8"/></svg>
            }
          </div>
          <label className="profile-avatar-upload-btn">
            CHANGE PHOTO
            <input type="file" accept="image/*,.heic,.heif" onChange={handleAvatarUpload} style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer', width: '100%', height: '100%' }} />
          </label>
        </div>

        <div className="profile-field"><label>NAME</label><input value={profile['p-name'] || ''} onChange={e => set('p-name', e.target.value)} placeholder="Your name" /></div>
        <div className="profile-section-label">STYLE</div>
        <div className="profile-field"><label>FAVORITE BRAND</label><input value={profile['p-fav-brand'] || ''} onChange={e => set('p-fav-brand', e.target.value)} placeholder="e.g. Maison Margiela" /></div>
        <div className="profile-field"><label>FAVORITE DESIGNER</label><input value={profile['p-fav-designer'] || ''} onChange={e => set('p-fav-designer', e.target.value)} placeholder="e.g. Rei Kawakubo" /></div>
        <div className="profile-field"><label>FAVORITE SEASON / COLLECTION</label><input value={profile['p-fav-season'] || ''} onChange={e => set('p-fav-season', e.target.value)} placeholder="e.g. Balenciaga SS17" /></div>
        <div className="profile-field"><label>AESTHETIC</label><input value={profile['p-aesthetic'] || ''} onChange={e => set('p-aesthetic', e.target.value)} placeholder="e.g. Avant-garde, Minimalist" /></div>
        <div className="profile-section-label">SIZING</div>
        <div className="profile-field"><label>CLOTHING SIZE</label><input value={profile['p-size-clothes'] || ''} onChange={e => set('p-size-clothes', e.target.value)} placeholder="e.g. M, L, 48" /></div>
        <div className="profile-field"><label>FOOTWEAR SIZE</label><input value={profile['p-size-shoes'] || ''} onChange={e => set('p-size-shoes', e.target.value)} placeholder="e.g. EU 42, US 9" /></div>
        <div className="profile-section-label">WISHLIST</div>
        <div className="profile-field"><label>GRAIL PIECE</label><input value={profile['p-grail'] || ''} onChange={e => set('p-grail', e.target.value)} placeholder="e.g. Helmut Lang AW02 Astro Parka" /></div>
        <div className="profile-field"><label>GRAIL BRAND</label><input value={profile['p-grail-brand'] || ''} onChange={e => set('p-grail-brand', e.target.value)} placeholder="e.g. Raf Simons, CP Company" /></div>
        <div className="profile-field"><label>BUDGET FOR GRAIL ($)</label><input type="number" min="0" value={profile['p-grail-budget'] || ''} onChange={e => set('p-grail-budget', e.target.value)} placeholder="0" /></div>
        <div className="profile-section-label">ABOUT</div>
        <div className="profile-field"><label>LOCATION</label><input value={profile['p-location'] || ''} onChange={e => set('p-location', e.target.value)} placeholder="e.g. Tokyo, London" /></div>
        <div className="profile-field"><label>BIO</label><textarea rows="3" value={profile['p-bio'] || ''} onChange={e => set('p-bio', e.target.value)} placeholder="A few words about your style..." /></div>

        {saveError && <div className="auth-error" style={{ marginBottom: 8 }}>{saveError}</div>}
        <button className="profile-save-btn" onClick={save}>SAVE PROFILE</button>
        <div className="profile-user-email">{user?.email || ''}</div>
        <button className="profile-signout-btn" onClick={onSignOut}>SIGN OUT</button>
      </div>
    </>
  );
}
