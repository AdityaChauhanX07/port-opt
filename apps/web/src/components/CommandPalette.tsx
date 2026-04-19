'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  LayoutDashboard, TrendingUp, LineChart,
  ShieldAlert, Sparkles, CornerDownLeft, Command,
} from 'lucide-react';

// ---------------------------------------------------------------------------
// Command definitions
// ---------------------------------------------------------------------------

interface Cmd {
  id: string;
  group: 'Navigate' | 'Actions';
  label: string;
  icon: React.ReactNode;
  shortcut?: string;
  action: () => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface Props {
  open: boolean;
  onClose: () => void;
}

export function CommandPalette({ open, onClose }: Props) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query,    setQuery]    = useState('');
  const [selected, setSelected] = useState(0);

  const go = useCallback((path: string) => { router.push(path); onClose(); }, [router, onClose]);

  const ALL_CMDS: Cmd[] = [
    { id: 'nav-dashboard', group: 'Navigate', label: 'Dashboard',   icon: <LayoutDashboard size={16} strokeWidth={1.5} />, action: () => go('/dashboard') },
    { id: 'nav-optimize',  group: 'Navigate', label: 'Optimize',    icon: <TrendingUp      size={16} strokeWidth={1.5} />, action: () => go('/optimize')  },
    { id: 'nav-backtest',  group: 'Navigate', label: 'Backtest',    icon: <LineChart       size={16} strokeWidth={1.5} />, action: () => go('/backtest')  },
    { id: 'nav-risk',      group: 'Navigate', label: 'Risk',        icon: <ShieldAlert     size={16} strokeWidth={1.5} />, action: () => go('/risk')      },
    { id: 'nav-research',  group: 'Navigate', label: 'Research',    icon: <Sparkles        size={16} strokeWidth={1.5} />, action: () => go('/research')  },
    {
      id: 'act-optimize',  group: 'Actions',  label: 'Run optimization',
      icon: <Command size={16} strokeWidth={1.5} />,
      shortcut: '⌘↵',
      action: () => { go('/optimize'); setTimeout(() => window.dispatchEvent(new CustomEvent('portopt:run-optimize')), 300); },
    },
    {
      id: 'act-load',      group: 'Actions',  label: 'Load data',
      icon: <CornerDownLeft size={16} strokeWidth={1.5} />,
      shortcut: '⌘L',
      action: () => { go('/optimize'); },
    },
  ];

  const filtered = query.trim()
    ? ALL_CMDS.filter((c) => c.label.toLowerCase().includes(query.toLowerCase()))
    : ALL_CMDS;

  // Reset on open
  useEffect(() => {
    if (open) { setQuery(''); setSelected(0); setTimeout(() => inputRef.current?.focus(), 10); }
  }, [open]);

  // Reset selection when filter changes
  useEffect(() => { setSelected(0); }, [query]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { onClose(); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); setSelected((s) => Math.min(s + 1, filtered.length - 1)); return; }
    if (e.key === 'ArrowUp')   { e.preventDefault(); setSelected((s) => Math.max(s - 1, 0)); return; }
    if (e.key === 'Enter') { e.preventDefault(); filtered[selected]?.action(); return; }
  }, [filtered, selected, onClose]);

  if (!open) return null;

  const groups = ['Navigate', 'Actions'] as const;

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 100, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: 120, background: 'rgba(0,0,0,0.6)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        style={{
          width: 560,
          background: 'var(--surface-elevated)',
          border: '1px solid var(--border)',
          borderRadius: 12,
          overflow: 'hidden',
          boxShadow: '0 8px 40px rgba(0,0,0,0.5)',
        }}
        onKeyDown={handleKeyDown}
      >
        {/* Search input */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '0 16px', borderBottom: '1px solid var(--border-subtle)' }}>
          <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--text-tertiary)', flexShrink: 0 }}>
            <circle cx="11" cy="11" r="8" />
            <path d="M21 21l-4.35-4.35" />
          </svg>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search or run a command…"
            style={{
              flex: 1,
              height: 48,
              background: 'transparent',
              border: 'none',
              outline: 'none',
              fontSize: 14,
              color: 'var(--text-primary)',
            }}
            className="placeholder:text-tertiary"
          />
          <kbd style={{ flexShrink: 0, fontSize: 11, color: 'var(--text-tertiary)', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 4, padding: '2px 5px', fontFamily: 'var(--font-mono)' }}>
            esc
          </kbd>
        </div>

        {/* Results */}
        <div style={{ maxHeight: 360, overflowY: 'auto', padding: '4px 0 8px' }}>
          {filtered.length === 0 ? (
            <p style={{ padding: '16px 16px', fontSize: 13, color: 'var(--text-tertiary)', textAlign: 'center' }}>
              No results for "{query}"
            </p>
          ) : (
            groups.map((group) => {
              const items = filtered.filter((c) => c.group === group);
              if (items.length === 0) return null;
              return (
                <div key={group}>
                  <p className="text-h3" style={{ color: 'var(--text-tertiary)', padding: '8px 16px 4px' }}>{group}</p>
                  {items.map((cmd) => {
                    const idx = filtered.indexOf(cmd);
                    const isSelected = idx === selected;
                    return (
                      <button
                        key={cmd.id}
                        onClick={cmd.action}
                        onMouseEnter={() => setSelected(idx)}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 10,
                          width: '100%',
                          height: 36,
                          padding: '0 16px',
                          background: isSelected ? 'var(--surface-elevated)' : 'transparent',
                          border: 'none',
                          cursor: 'pointer',
                          textAlign: 'left',
                          transition: `background var(--duration-micro) var(--ease)`,
                        }}
                      >
                        <span style={{ color: 'var(--text-tertiary)', flexShrink: 0, display: 'flex' }}>{cmd.icon}</span>
                        <span style={{ flex: 1, fontSize: 13, color: isSelected ? 'var(--text-primary)' : 'var(--text-secondary)' }}>{cmd.label}</span>
                        {cmd.shortcut && (
                          <kbd style={{ fontSize: 11, color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}>{cmd.shortcut}</kbd>
                        )}
                      </button>
                    );
                  })}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
