'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { AnimatePresence, motion } from 'framer-motion';
import {
  LayoutDashboard,
  TrendingUp,
  LineChart,
  ShieldAlert,
  Sparkles,
  Settings,
} from 'lucide-react';
import { CommandPalette } from '@/components/CommandPalette';
import { SettingsDialog } from '@/components/SettingsDialog';

// ---------------------------------------------------------------------------
// Nav config
// ---------------------------------------------------------------------------

const NAV_ITEMS = [
  { href: '/dashboard', label: 'Dashboard', Icon: LayoutDashboard },
  { href: '/optimize',  label: 'Optimize',  Icon: TrendingUp      },
  { href: '/backtest',  label: 'Backtest',  Icon: LineChart        },
  { href: '/risk',      label: 'Risk',      Icon: ShieldAlert      },
  { href: '/research',  label: 'Research',  Icon: Sparkles         },
] as const;

const PAGE_TITLES: Record<string, string> = {
  '/dashboard': 'Dashboard',
  '/optimize':  'Optimize',
  '/backtest':  'Backtest',
  '/risk':      'Risk',
  '/research':  'Research',
};

function getPageTitle(pathname: string): string {
  for (const [prefix, title] of Object.entries(PAGE_TITLES)) {
    if (pathname === prefix || pathname.startsWith(prefix + '/')) return title;
  }
  return 'PortOpt';
}

// ---------------------------------------------------------------------------
// Sidebar
// ---------------------------------------------------------------------------

function Sidebar({ pathname, onOpenPalette }: { pathname: string; onOpenPalette?: () => void }) {
  return (
    <nav
      aria-label="Main navigation"
      style={{
        width: 240,
        minWidth: 240,
        background: 'var(--bg)',
        borderRight: '1px solid var(--border-subtle)',
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Wordmark */}
      <div
        style={{
          paddingTop: 24,
          paddingBottom: 16,
          paddingLeft: 12,
          paddingRight: 12,
        }}
      >
        <div className="flex items-center gap-2 select-none">
          {/* Brand mark — 6px accent square */}
          <span
            style={{
              display: 'inline-block',
              width: 6,
              height: 6,
              borderRadius: 1,
              background: 'var(--accent)',
              flexShrink: 0,
            }}
          />
          <span
            style={{
              fontSize: 15,
              fontWeight: 600,
              color: 'var(--text-primary)',
              lineHeight: 1,
            }}
          >
            PortOpt
          </span>
        </div>
      </div>

      {/* Nav items */}
      <div className="flex-1 overflow-y-auto px-[6px] py-1">
        {NAV_ITEMS.map(({ href, label, Icon }) => {
          const active = pathname === href || pathname.startsWith(href + '/');
          return (
            <Link
              key={href}
              href={href}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                paddingTop: 8,
                paddingBottom: 8,
                paddingLeft: active ? 10 : 12,
                paddingRight: 12,
                borderRadius: 6,
                fontSize: 13,
                fontWeight: 500,
                textDecoration: 'none',
                color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
                background: active ? 'var(--surface-elevated)' : 'transparent',
                borderLeft: active ? '2px solid var(--accent)' : '2px solid transparent',
                transition: `background-color var(--duration-micro) var(--ease), color var(--duration-micro) var(--ease)`,
                marginBottom: 2,
              }}
              className={active ? '' : 'hover:bg-[var(--surface-elevated)] hover:text-primary'}
            >
              <Icon
                size={16}
                strokeWidth={1.5}
                style={{ color: active ? 'var(--text-primary)' : 'var(--text-secondary)', flexShrink: 0 }}
              />
              {label}
            </Link>
          );
        })}
      </div>

      {/* Bottom hint — clickable to open palette */}
      <button
        type="button"
        onClick={onOpenPalette}
        style={{
          flexShrink: 0,
          borderTop: '1px solid var(--border-subtle)',
          padding: 12,
          width: '100%',
          textAlign: 'left',
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          transition: `background var(--duration-micro) var(--ease)`,
        }}
        className="hover:bg-[var(--surface)]"
        aria-label="Open command palette"
      >
        <span className="select-none" style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>Search commands</span>
        <kbd style={{ fontSize: 11, color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 3, padding: '1px 4px' }}>⌘K</kbd>
      </button>
    </nav>
  );
}

// ---------------------------------------------------------------------------
// Top bar
// ---------------------------------------------------------------------------

function TopBar({ title, onOpenSettings }: { title: string; onOpenSettings?: () => void }) {
  const [hoveringSettings, setHoveringSettings] = useState(false);

  return (
    <header
      style={{
        height: 56,
        background: 'var(--bg)',
        borderBottom: '1px solid var(--border-subtle)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingLeft: 32,
        paddingRight: 24,
        flexShrink: 0,
      }}
    >
      <span style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-secondary)' }}>
        {title}
      </span>

      {/* Settings button with tooltip */}
      <div style={{ position: 'relative' }}>
        <button
          aria-label="Settings"
          onClick={onOpenSettings}
          onMouseEnter={() => setHoveringSettings(true)}
          onMouseLeave={() => setHoveringSettings(false)}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 32,
            height: 32,
            borderRadius: 6,
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            color: hoveringSettings ? 'var(--text-secondary)' : 'var(--text-tertiary)',
            transition: `color var(--duration-micro) var(--ease)`,
          }}
        >
          <Settings size={16} strokeWidth={1.5} />
        </button>

        {/* Tooltip */}
        {hoveringSettings && (
          <div
            style={{
              position: 'absolute',
              top: '100%',
              right: 0,
              marginTop: 6,
              background: 'var(--surface-elevated)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-md)',
              padding: '4px 8px',
              fontSize: 12,
              color: 'var(--text-secondary)',
              whiteSpace: 'nowrap',
              pointerEvents: 'none',
              zIndex: 50,
            }}
          >
            Settings
          </div>
        )}
      </div>
    </header>
  );
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const pageTitle = getPageTitle(pathname);
  const [paletteOpen,  setPaletteOpen]  = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const openPalette   = useCallback(() => setPaletteOpen(true),   []);
  const closePalette  = useCallback(() => setPaletteOpen(false),  []);
  const openSettings  = useCallback(() => setSettingsOpen(true),  []);
  const closeSettings = useCallback(() => setSettingsOpen(false), []);

  // Global ⌘K / Ctrl+K handler
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
      if (e.key === 'Escape' && paletteOpen) {
        setPaletteOpen(false);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [paletteOpen]);

  return (
    <>
      <div
        style={{ display: 'flex', height: '100vh', overflow: 'hidden', background: 'var(--bg)' }}
      >
        <Sidebar pathname={pathname} onOpenPalette={openPalette} />

        {/* Right column: top bar + scrollable content */}
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <TopBar title={pageTitle} onOpenSettings={openSettings} />

          <main
            id="main-content"
            tabIndex={-1}
            style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden' }}
          >
            {/* Centered content well */}
            <div
              style={{
                maxWidth: 1600,
                margin: '0 auto',
                paddingLeft: 32,
                paddingRight: 32,
                paddingTop: 32,
              }}
            >
              <AnimatePresence mode="wait" initial={false}>
                <motion.div
                  key={pathname}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.15, ease: [0.2, 0, 0, 1] }}
                >
                  {children}
                </motion.div>
              </AnimatePresence>
            </div>
          </main>
        </div>
      </div>

      <CommandPalette open={paletteOpen}  onClose={closePalette}  />
      <SettingsDialog  open={settingsOpen} onClose={closeSettings} />
    </>
  );
}
