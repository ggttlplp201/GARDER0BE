import { useState, useEffect } from 'react';

export function useTheme() {
  const [dark, setDark] = useState(() => {
    try { return localStorage.getItem('garderobe-theme') === 'dark'; } catch { return false; }
  });

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    try { localStorage.setItem('garderobe-theme', dark ? 'dark' : 'light'); } catch {}
  }, [dark]);

  return { dark, toggle: () => setDark(d => !d) };
}
