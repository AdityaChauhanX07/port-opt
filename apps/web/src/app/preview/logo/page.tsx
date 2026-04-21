import React from 'react';
import { Logo } from '@/components/brand/Logo';

const SIZES = [16, 24, 32, 48, 64] as const;

export default function LogoPreview() {
  return (
    <main style={{
      minHeight: '100vh',
      background: '#050507',
      color: '#EDEDEE',
      fontFamily: 'var(--font-sans, system-ui, sans-serif)',
      padding: '64px 48px',
    }}>
      <p style={{
        fontFamily: 'var(--font-mono, monospace)',
        fontSize: 11,
        letterSpacing: '0.14em',
        textTransform: 'uppercase',
        color: '#6B6B73',
        marginBottom: 56,
      }}>
        Logo preview — all scales
      </p>

      {/* With wordmark */}
      <section style={{ marginBottom: 72 }}>
        <p style={{ fontSize: 12, color: '#6B6B73', marginBottom: 32,
          fontFamily: 'var(--font-mono, monospace)', letterSpacing: '0.08em' }}>
          showWordmark={'{true}'}
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>
          {SIZES.map((s) => (
            <div key={s} style={{ display: 'flex', alignItems: 'center', gap: 32 }}>
              <Logo size={s} showWordmark />
              <span style={{
                fontFamily: 'var(--font-mono, monospace)',
                fontSize: 11,
                color: '#3A3A42',
              }}>
                size={s}
              </span>
            </div>
          ))}
        </div>
      </section>

      {/* Mark only */}
      <section style={{ marginBottom: 72 }}>
        <p style={{ fontSize: 12, color: '#6B6B73', marginBottom: 32,
          fontFamily: 'var(--font-mono, monospace)', letterSpacing: '0.08em' }}>
          showWordmark={'{false}'}
        </p>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 32 }}>
          {SIZES.map((s) => (
            <div key={s} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
              <Logo size={s} showWordmark={false} />
              <span style={{
                fontFamily: 'var(--font-mono, monospace)',
                fontSize: 11,
                color: '#3A3A42',
              }}>
                {s}
              </span>
            </div>
          ))}
        </div>
      </section>

      {/* On light background */}
      <section style={{ marginBottom: 72 }}>
        <p style={{ fontSize: 12, color: '#6B6B73', marginBottom: 32,
          fontFamily: 'var(--font-mono, monospace)', letterSpacing: '0.08em' }}>
          on light — color inherits from parent
        </p>
        <div style={{
          background: '#F5F5F0',
          borderRadius: 12,
          padding: '32px 40px',
          display: 'flex',
          flexDirection: 'column',
          gap: 28,
        }}>
          {[32, 48].map((s) => (
            <Logo key={s} size={s} showWordmark style={{ color: '#1A1A1E' }} />
          ))}
        </div>
      </section>

      {/* Tinted */}
      <section>
        <p style={{ fontSize: 12, color: '#6B6B73', marginBottom: 32,
          fontFamily: 'var(--font-mono, monospace)', letterSpacing: '0.08em' }}>
          tinted — color: #3B82F6
        </p>
        <Logo size={32} showWordmark style={{ color: '#3B82F6' }} />
      </section>
    </main>
  );
}
