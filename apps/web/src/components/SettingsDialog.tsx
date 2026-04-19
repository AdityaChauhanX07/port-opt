'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { X, Check, AlertCircle } from 'lucide-react';
import { Button, Input, Select } from '@portopt/ui';
import { api } from '@/lib/trpc/client';

// ---------------------------------------------------------------------------
// localStorage keys + helpers
// ---------------------------------------------------------------------------

const KEY_THEME    = 'portopt:theme';
const KEY_DEFAULTS = 'portopt:defaults';
const KEY_DATA_URL = 'portopt:dataServiceUrl';

export interface PortOptDefaults {
  rf:             number;
  shrinkageAlpha: number;
  frequency:      'daily' | 'weekly' | 'monthly';
  nPoints:        number;
}

export function loadDefaults(): PortOptDefaults {
  try {
    const raw = localStorage.getItem(KEY_DEFAULTS);
    if (raw) return { ...DEFAULT_VALUES, ...JSON.parse(raw) };
  } catch { /* ignore */ }
  return DEFAULT_VALUES;
}

export function loadDataServiceUrl(): string {
  try {
    return localStorage.getItem(KEY_DATA_URL) ?? DEFAULT_DATA_URL;
  } catch {
    return DEFAULT_DATA_URL;
  }
}

const DEFAULT_VALUES: PortOptDefaults = {
  rf:             0.03,
  shrinkageAlpha: 0.10,
  frequency:      'daily',
  nPoints:        20,
};

const DEFAULT_DATA_URL = 'http://localhost:8888';

// ---------------------------------------------------------------------------
// Section header
// ---------------------------------------------------------------------------

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-h3" style={{ color: 'var(--text-tertiary)', marginBottom: 16 }}>
      {children}
    </p>
  );
}

// ---------------------------------------------------------------------------
// SettingsDialog
// ---------------------------------------------------------------------------

interface Props {
  open: boolean;
  onClose: () => void;
}

export function SettingsDialog({ open, onClose }: Props) {
  // ── Theme ─────────────────────────────────────────────────────────────────
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');

  // ── Defaults ──────────────────────────────────────────────────────────────
  const [rf,             setRf]             = useState(DEFAULT_VALUES.rf);
  const [shrinkageAlpha, setShrinkageAlpha] = useState(DEFAULT_VALUES.shrinkageAlpha);
  const [frequency,      setFrequency]      = useState<PortOptDefaults['frequency']>(DEFAULT_VALUES.frequency);
  const [nPoints,        setNPoints]        = useState(DEFAULT_VALUES.nPoints);
  const [defaultsSaved,  setDefaultsSaved]  = useState(false);

  // ── Data service ──────────────────────────────────────────────────────────
  const [dataUrl,      setDataUrl]      = useState(DEFAULT_DATA_URL);
  const [pingStatus,   setPingStatus]   = useState<'idle' | 'loading' | 'ok' | 'error'>('idle');

  const pingMutation = api.data.pingDataService.useMutation({
    onSuccess: (data) => setPingStatus(data.ok ? 'ok' : 'error'),
    onError:   ()     => setPingStatus('error'),
  });

  // ── Load from localStorage on open ────────────────────────────────────────
  useEffect(() => {
    if (!open) return;
    try {
      const t = localStorage.getItem(KEY_THEME);
      if (t === 'dark' || t === 'light') setTheme(t);

      const d = loadDefaults();
      setRf(d.rf);
      setShrinkageAlpha(d.shrinkageAlpha);
      setFrequency(d.frequency);
      setNPoints(d.nPoints);

      setDataUrl(loadDataServiceUrl());
      setPingStatus('idle');
      setDefaultsSaved(false);
    } catch { /* ignore */ }
  }, [open]);

  // ── Handlers ──────────────────────────────────────────────────────────────
  const handleSaveDefaults = useCallback(() => {
    const val: PortOptDefaults = { rf, shrinkageAlpha, frequency, nPoints };
    localStorage.setItem(KEY_DEFAULTS, JSON.stringify(val));
    setDefaultsSaved(true);
    setTimeout(() => setDefaultsSaved(false), 2000);
  }, [rf, shrinkageAlpha, frequency, nPoints]);

  const handleSaveDataUrl = useCallback(() => {
    const trimmed = dataUrl.trim().replace(/\/$/, '');
    setDataUrl(trimmed);
    localStorage.setItem(KEY_DATA_URL, trimmed);
  }, [dataUrl]);

  const handleTestConnection = useCallback(() => {
    handleSaveDataUrl();
    setPingStatus('loading');
    pingMutation.mutate({ url: dataUrl.trim().replace(/\/$/, '') });
  }, [dataUrl, handleSaveDataUrl, pingMutation]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') onClose();
  }, [onClose]);

  if (!open) return null;

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 100,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(0,0,0,0.6)',
        padding: 24,
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      onKeyDown={handleKeyDown}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        style={{
          width: '100%',
          maxWidth: 480,
          background: 'var(--surface-elevated)',
          border: '1px solid var(--border)',
          borderRadius: 12,
          padding: 24,
          maxHeight: 'calc(100vh - 48px)',
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: 0,
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
          <h2 style={{ fontSize: 18, fontWeight: 600, color: 'var(--text-primary)', letterSpacing: '-0.01em' }}>
            Settings
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close settings"
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              width: 28, height: 28, borderRadius: 'var(--radius-sm)',
              background: 'transparent', border: 'none', cursor: 'pointer',
              color: 'var(--text-tertiary)',
              transition: `color var(--duration-micro) var(--ease), background var(--duration-micro) var(--ease)`,
            }}
            className="hover:text-primary hover:bg-[var(--surface)]"
          >
            <X size={16} strokeWidth={1.5} />
          </button>
        </div>

        {/* ── Section 1: Theme ──────────────────────────────────────────── */}
        <div style={{ marginBottom: 28 }}>
          <SectionHeader>Theme</SectionHeader>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>

            {/* Dark — active */}
            <button
              type="button"
              onClick={() => { setTheme('dark'); localStorage.setItem(KEY_THEME, 'dark'); }}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '10px 14px', borderRadius: 'var(--radius-md)',
                border: `1px solid ${theme === 'dark' ? 'var(--accent)' : 'var(--border)'}`,
                background: theme === 'dark' ? 'var(--accent-dim)' : 'transparent',
                cursor: 'pointer',
                transition: `border-color var(--duration-micro) var(--ease), background var(--duration-micro) var(--ease)`,
              }}
            >
              <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)' }}>Dark</span>
              {theme === 'dark' && (
                <Check size={14} strokeWidth={2} style={{ color: 'var(--accent)', flexShrink: 0 }} />
              )}
            </button>

            {/* Light — disabled */}
            <div
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '10px 14px', borderRadius: 'var(--radius-md)',
                border: '1px solid var(--border-subtle)',
                background: 'transparent',
                opacity: 0.5,
                cursor: 'not-allowed',
              }}
            >
              <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-secondary)' }}>Light</span>
              <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>Coming soon</span>
            </div>

          </div>
        </div>

        <div style={{ borderTop: '1px solid var(--border-subtle)', marginBottom: 28 }} />

        {/* ── Section 2: Default Parameters ────────────────────────────── */}
        <div style={{ marginBottom: 28 }}>
          <SectionHeader>Default Parameters</SectionHeader>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

            <Row label="Risk-free rate">
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <Input
                  type="number"
                  variant="mono"
                  value={rf}
                  step={0.001}
                  min={0}
                  max={0.2}
                  onChange={(e) => setRf(parseFloat(e.target.value) || 0)}
                  className="w-24 h-8"
                />
                <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>%</span>
              </div>
            </Row>

            <Row label="Shrinkage alpha">
              <Input
                type="number"
                variant="mono"
                value={shrinkageAlpha}
                step={0.01}
                min={0}
                max={1}
                onChange={(e) => setShrinkageAlpha(parseFloat(e.target.value) || 0)}
                className="w-24 h-8"
              />
            </Row>

            <Row label="Frequency">
              <Select
                value={frequency}
                onValueChange={(v) => setFrequency(v as PortOptDefaults['frequency'])}
                options={[
                  { value: 'daily',   label: 'Daily'   },
                  { value: 'weekly',  label: 'Weekly'  },
                  { value: 'monthly', label: 'Monthly' },
                ]}
                className="w-32"
              />
            </Row>

            <Row label="Frontier points">
              <Input
                type="number"
                variant="mono"
                value={nPoints}
                step={5}
                min={5}
                max={200}
                onChange={(e) => setNPoints(parseInt(e.target.value) || 20)}
                className="w-24 h-8"
              />
            </Row>

            <div style={{ paddingTop: 4 }}>
              <Button
                variant="secondary"
                size="sm"
                onClick={handleSaveDefaults}
              >
                {defaultsSaved ? (
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Check size={13} strokeWidth={2} />
                    Saved
                  </span>
                ) : 'Save defaults'}
              </Button>
            </div>

          </div>
        </div>

        <div style={{ borderTop: '1px solid var(--border-subtle)', marginBottom: 28 }} />

        {/* ── Section 3: Data ──────────────────────────────────────────── */}
        <div>
          <SectionHeader>Data</SectionHeader>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

            <div>
              <p style={{ fontSize: 11, color: 'var(--text-tertiary)', marginBottom: 6 }}>Data service URL</p>
              <Input
                type="text"
                variant="mono"
                value={dataUrl}
                onChange={(e) => setDataUrl(e.target.value)}
                onBlur={handleSaveDataUrl}
                placeholder="http://localhost:8888"
              />
              <p style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 4 }}>
                To change the URL used for live data, set DATA_SERVICE_URL in .env.local and restart.
              </p>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <Button
                variant="secondary"
                size="sm"
                onClick={handleTestConnection}
                loading={pingStatus === 'loading'}
                disabled={pingStatus === 'loading'}
              >
                Test connection
              </Button>

              {pingStatus === 'ok' && (
                <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 13, color: 'var(--positive)' }}>
                  <Check size={14} strokeWidth={2} />
                  Connected
                </span>
              )}
              {pingStatus === 'error' && (
                <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 13, color: 'var(--negative)' }}>
                  <AlertCircle size={14} strokeWidth={1.5} />
                  Unreachable
                </span>
              )}
            </div>

          </div>
        </div>

      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Row helper
// ---------------------------------------------------------------------------

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
      <span style={{ fontSize: 13, color: 'var(--text-secondary)', flexShrink: 0 }}>{label}</span>
      {children}
    </div>
  );
}
