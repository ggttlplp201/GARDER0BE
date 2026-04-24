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

  async function signIn(email, password) {
    const { data, error } = await sb.auth.signInWithPassword({ email, password });
    return { data, error };
  }

  async function signUp(email, password) {
    const { data, error } = await sb.auth.signUp({ email, password });
    return { data, error };
  }

  async function signOut() {
    await sb.auth.signOut();
  }

  return { user, authMode, setAuthMode, signIn, signUp, signOut };
}
