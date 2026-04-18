'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';

const NAV_ITEMS = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/optimize',  label: 'Optimize' },
  { href: '/backtest',  label: 'Backtest' },
  { href: '/risk',      label: 'Risk' },
  { href: '/research',  label: 'Research' },
] as const;

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-bg text-primary">
      {/* Responsive guard — app requires ≥ 1024px */}
      <div className="flex h-screen items-center justify-center bg-bg lg:hidden">
        <div className="max-w-xs text-center px-6">
          <p className="text-[15px] font-medium text-primary mb-2">Screen too narrow</p>
          <p className="text-[13px] text-muted">PortOpt requires a screen width of at least 1024 px. Please use a larger display or zoom out.</p>
        </div>
      </div>

      {/* App shell — hidden on small screens */}
      <div className="hidden lg:flex h-full flex-col overflow-hidden">
        {/* ── Top bar ─────────────────────────────────────────────────── */}
        <header
          className="flex h-11 shrink-0 items-center justify-between px-4 hairline-b"
          style={{ background: 'var(--bg)' }}
        >
          <span className="text-[14px] font-semibold tracking-tight text-primary select-none">
            PortOpt
          </span>

          <button
            className="flex h-7 w-7 items-center justify-center rounded text-tertiary hover:text-primary hover:bg-[var(--bg-hover)] transition-colors duration-[var(--duration-fast)] focus:outline-none"
            aria-label="Settings"
            title="Settings"
          >
            <SettingsIcon size={15} />
          </button>
        </header>

        {/* ── Body: sidenav + content ──────────────────────────────── */}
        <div className="flex flex-1 min-h-0">
          <SideNav />

          <main className="flex-1 overflow-auto" id="main-content" tabIndex={-1}>
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={pathname}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15, ease: [0.16, 1, 0.3, 1] }}
                className="h-full"
              >
                {children}
              </motion.div>
            </AnimatePresence>
          </main>
        </div>
      </div>
    </div>
  );
}

function SideNav() {
  const pathname = usePathname();

  return (
    <nav
      className="flex w-[180px] shrink-0 flex-col overflow-y-auto hairline-r"
      style={{ background: 'var(--bg)' }}
      aria-label="Main navigation"
    >
      <div className="flex-1 py-2">
        {NAV_ITEMS.map(({ href, label }) => {
          const active = pathname === href || pathname.startsWith(href + '/');
          return (
            <Link
              key={href}
              href={href}
              className={[
                'flex h-[30px] items-center px-[10px] text-[13px] rounded-sm mx-1',
                'transition-colors duration-[var(--duration-fast)]',
                active
                  ? 'text-primary bg-[var(--bg-hover)]'
                  : 'text-secondary hover:text-primary hover:bg-[var(--bg-hover)]',
              ].join(' ')}
            >
              {label}
            </Link>
          );
        })}
      </div>

      <div className="hairline-t px-[10px] py-3">
        <span className="text-[11px] text-muted select-none">⌘K to search</span>
      </div>
    </nav>
  );
}

function SettingsIcon({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}
