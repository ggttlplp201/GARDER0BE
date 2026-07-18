import { useState, useEffect } from 'react';
import { sb } from '../lib/supabase';

export function useAuth() {
  const [user, setUser]       = useState(undefined); // undefined = loading
  const [authMode, setAuthMode] = useState('signin');

  useEffect(() => {
    // Use getSession (local cache) first to avoid logout on refresh
    sb.auth.getSession().then(({ data: { session } }) => setUser(session?.user || null));
    const { data: { subscription } } = sb.auth.onAuthStateChange((_, session) => {
      setUser(session?.user || null);
    });
    return () => subscription.unsubscribe();
  }, []);

  async function signIn(email, password, captchaToken) {
    const { data, error } = await sb.auth.signInWithPassword({
      email,
      password,
      options: { captchaToken },
    });
    return { data, error };
  }

  async function signUp(email, password, captchaToken) {
    let ref = null;
    try { ref = sessionStorage.getItem('garderobe-ref') || null; } catch {}
    const options = { captchaToken };
    if (ref) options.data = { ref };
    const { data, error } = await sb.auth.signUp({ email, password, options });
    return { data, error };
  }

  async function signOut() {
    await sb.auth.signOut();
  }

  async function resendVerification(email) {
    const { error } = await sb.auth.resend({ type: 'signup', email });
    return { error };
  }

  async function mfaEnroll() {
    return await sb.auth.mfa.enroll({ factorType: 'totp', issuer: 'GARDEROBE' });
  }

  async function mfaVerify(factorId, code) {
    const { data: challenge, error: cErr } = await sb.auth.mfa.challenge({ factorId });
    if (cErr) return { error: cErr };
    return await sb.auth.mfa.verify({ factorId, challengeId: challenge.id, code });
  }

  async function mfaUnenroll(factorId) {
    return await sb.auth.mfa.unenroll({ factorId });
  }

  async function mfaListFactors() {
    return await sb.auth.mfa.listFactors();
  }

  async function mfaGetLevel() {
    return await sb.auth.mfa.getAuthenticatorAssuranceLevel();
  }

  return {
    user, authMode, setAuthMode,
    signIn, signUp, signOut, resendVerification,
    mfaEnroll, mfaVerify, mfaUnenroll, mfaListFactors, mfaGetLevel,
  };
}
