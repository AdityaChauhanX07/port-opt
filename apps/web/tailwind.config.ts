import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
    '../../packages/ui/src/**/*.{js,ts,jsx,tsx}',
    '../../packages/charts/src/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        /* ── New design tokens ── */
        bg: 'var(--bg)',
        surface: 'var(--surface)',
        'surface-elevated': 'var(--surface-elevated)',
        inset: 'var(--bg-inset)',
        'border-subtle': 'var(--border-subtle)',
        border: 'var(--border)',
        'border-strong': 'var(--border-strong)',
        primary: 'var(--text-primary)',
        secondary: 'var(--text-secondary)',
        tertiary: 'var(--text-tertiary)',
        accent: 'var(--accent)',
        'accent-hover': 'var(--accent-hover)',
        'accent-dim': 'var(--accent-dim)',
        positive: 'var(--positive)',
        'positive-subtle': 'var(--positive-subtle)',
        negative: 'var(--negative)',
        'negative-subtle': 'var(--negative-subtle)',
        warning: 'var(--warning)',
        /* ── Backward-compat aliases ── */
        elevated: 'var(--bg-elevated)',
        hover: 'var(--bg-hover)',
        subtle: 'var(--bg-subtle)',
        'border-focus': 'var(--border-focus)',
        muted: 'var(--text-muted)',
        'accent-subtle': 'var(--accent-subtle)',
        'accent-muted': 'var(--accent-muted)',
        gain: 'var(--positive)',
        'gain-subtle': 'var(--positive-subtle)',
        loss: 'var(--negative)',
        'loss-subtle': 'var(--negative-subtle)',
        neutral: 'var(--neutral)',
        warn: 'var(--warning)',
        'warn-subtle': 'var(--warn-subtle)',
      },
      fontFamily: {
        sans: ['var(--font-sans)', 'system-ui', 'sans-serif'],
        mono: ['var(--font-mono)', 'monospace'],
      },
      transitionTimingFunction: {
        custom: 'var(--ease)',
      },
      transitionDuration: {
        micro: 'var(--duration-micro)',
        small: 'var(--duration-small)',
        medium: 'var(--duration-medium)',
        large: 'var(--duration-large)',
        /* legacy */
        fast: 'var(--duration-fast)',
        DEFAULT: 'var(--duration)',
        slow: 'var(--duration-slow)',
      },
      borderRadius: {
        sm: 'var(--radius-sm)',
        DEFAULT: 'var(--radius)',
        md: 'var(--radius-md)',
        lg: 'var(--radius-lg)',
      },
    },
  },
  plugins: [],
};

export default config;
