'use client';

import { useCallback, useEffect, useState } from 'react';

export type Theme = 'dark' | 'light';

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>('dark');

  useEffect(() => {
    const stored = (localStorage.getItem('portopt-theme') ?? 'dark') as Theme;
    setThemeState(stored);
    document.documentElement.setAttribute('data-theme', stored);
  }, []);

  const setTheme = useCallback((t: Theme) => {
    setThemeState(t);
    localStorage.setItem('portopt-theme', t);
    document.documentElement.setAttribute('data-theme', t);
  }, []);

  return { theme, setTheme };
}
