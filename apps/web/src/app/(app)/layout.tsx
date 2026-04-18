'use client';

import React from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { signOut, useSession } from 'next-auth/react';
import { api } from '@/lib/trpc/client';

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

          <UserWidget />
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

function UserWidget() {
  const { data: session, status } = useSession();

  if (status === 'loading') {
    return <div className="skeleton h-6 w-24 rounded" />;
  }

  if (!session?.user) {
    return (
      <Link
        href="/login"
        className="text-[12px] text-accent hover:underline"
      >
        Sign in
      </Link>
    );
  }

  const { name, email, image } = session.user;
  const initials = (name ?? email ?? '?').slice(0, 2).toUpperCase();

  return (
    <div className="flex items-center gap-2">
      <span className="text-[12px] text-secondary hidden sm:block truncate max-w-[140px]">
        {name ?? email}
      </span>

      {image ? (
        <Image
          src={image}
          alt={name ?? 'User avatar'}
          width={24}
          height={24}
          className="rounded-full"
        />
      ) : (
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[var(--bg-hover)] text-[10px] font-medium text-primary border border-[var(--border)]">
          {initials}
        </span>
      )}

      <button
        onClick={() => signOut({ callbackUrl: '/login' })}
        className="text-[11px] text-muted hover:text-primary transition-colors ml-1"
        title="Sign out"
        aria-label="Sign out"
      >
        <LogOutIcon />
      </button>
    </div>
  );
}

function SideNav() {
  const pathname = usePathname();
  const { status } = useSession();
  const { data: portfolios } = api.user.listPortfolios.useQuery(undefined, {
    enabled: status === 'authenticated',
    staleTime: 60_000,
  });
  const savedCount = portfolios?.length ?? 0;

  return (
    <nav
      className="flex w-[180px] shrink-0 flex-col overflow-y-auto hairline-r"
      style={{ background: 'var(--bg)' }}
      aria-label="Main navigation"
    >
      <div className="flex-1 py-2">
        {NAV_ITEMS.map(({ href, label }) => {
          const active = pathname === href || pathname.startsWith(href + '/');
          const isDashboard = href === '/dashboard';
          return (
            <Link
              key={href}
              href={href}
              className={[
                'flex h-[30px] items-center justify-between px-[10px] text-[13px] rounded-sm mx-1',
                'transition-colors duration-[var(--duration-fast)]',
                active
                  ? 'text-primary bg-[var(--bg-hover)]'
                  : 'text-secondary hover:text-primary hover:bg-[var(--bg-hover)]',
              ].join(' ')}
            >
              <span>{label}</span>
              {isDashboard && savedCount > 0 && (
                <span className="flex h-4 min-w-[16px] items-center justify-center rounded-full bg-[var(--accent)] px-1 text-[10px] font-medium text-white leading-none">
                  {savedCount > 99 ? '99+' : savedCount}
                </span>
              )}
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

function LogOutIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  );
}
