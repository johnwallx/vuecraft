import { useEffect, useState } from 'react';

export type ThemePref = 'system' | 'light' | 'dark';
const KEY = 'vuecraft.theme';
const query = () => window.matchMedia?.('(prefers-color-scheme: dark)');

export function useTheme() {
  const [pref, setPref] = useState<ThemePref>(() => {
    try {
      const v = localStorage.getItem(KEY);
      return v === 'light' || v === 'dark' ? v : 'system';
    } catch {
      return 'system';
    }
  });
  const [systemDark, setSystemDark] = useState(() => query()?.matches ?? false);

  useEffect(() => {
    const mq = query();
    if (!mq) return;
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const dark = pref === 'dark' || (pref === 'system' && systemDark);

  useEffect(() => {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    try {
      localStorage.setItem(KEY, pref);
    } catch {
      // Theme just won't persist.
    }
  }, [dark, pref]);

  const cycle = () => setPref((p) => (p === 'system' ? 'light' : p === 'light' ? 'dark' : 'system'));
  return { pref, dark, cycle };
}
