'use client';

import React, { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { motion, useInView, useReducedMotion } from 'framer-motion';
import { Logo } from '@/components/brand/Logo';

// ---------------------------------------------------------------------------
// Frontier geometry — preserved for "The frontier, interactive" section (step 2)
// ---------------------------------------------------------------------------

const VB = { w: 880, h: 440 };
const M  = { t: 40, r: 48, b: 52, l: 64 };
const IW = VB.w - M.l - M.r;  // 768
const IH = VB.h - M.t - M.b;  // 348

const X_SCALE = 40;
const Y_SCALE = 24;

function toSVG(volPct: number, retPct: number): [number, number] {
  return [
    M.l + (volPct / X_SCALE) * IW,
    VB.h - M.b - (retPct / Y_SCALE) * IH,
  ];
}

function frontierVol(t: number) { return 7 + 33 * t; }
function frontierRet(t: number) { return 3.5 + 32 * t - 12 * t * t; }

function buildFrontier(n = 100): string {
  let d = '';
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const [x, y] = toSVG(frontierVol(t), frontierRet(t));
    d += `${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)} `;
  }
  return d.trim();
}

function estimateLen(n = 100): number {
  let len = 0, prev: [number, number] | null = null;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const cur = toSVG(frontierVol(t), frontierRet(t));
    if (prev) len += Math.hypot(cur[0] - prev[0], cur[1] - prev[1]);
    prev = cur;
  }
  return len;
}

const FRONTIER_D   = buildFrontier();
const FRONTIER_LEN = estimateLen();

const T_TAN  = 0.422;
const TX_PCT = frontierVol(T_TAN);
const TY_PCT = frontierRet(T_TAN);
const [TX, TY] = toSVG(TX_PCT, TY_PCT);

const RF_PCT  = 1.0;
const [, RFY] = toSVG(0, RF_PCT);
const CML_SLOPE = (TY - RFY) / (TX - M.l);
const CML_END_X = M.l + (M.t - RFY) / CML_SLOPE;
const CML_D  = `M${M.l},${RFY.toFixed(1)} L${CML_END_X.toFixed(1)},${M.t}`;

const X_AXIS = `M${M.l},${VB.h - M.b} L${VB.w - M.r},${VB.h - M.b}`;
const Y_AXIS = `M${M.l},${M.t} L${M.l},${VB.h - M.b}`;

const ASSETS: [string, number, number, string][] = [
  ['TLT',  8,  2,  '#10B981'],
  ['GLD',  14, 6,  '#F59E0B'],
  ['SPY',  16, 10, '#3B82F6'],
  ['IWM',  22, 11, '#06B6D4'],
  ['QQQ',  20, 13, '#8B5CF6'],
  ['MSFT', 26, 16, '#6366F1'],
  ['AAPL', 30, 18, '#EC4899'],
];

// ---------------------------------------------------------------------------
// Ghost frontier path — full-viewport background atmosphere
// Cubic bezier entering lower-left, exiting upper-right, through center
// ---------------------------------------------------------------------------

const GHOST_D = 'M -50,900 C 300,750 800,300 1500,0';

// ---------------------------------------------------------------------------
// Shared constants
// ---------------------------------------------------------------------------

type Easing4 = [number, number, number, number];
const EASE: Easing4 = [0.2, 0, 0, 1];
const OVERSHOOT: Easing4 = [0.34, 1.56, 0.64, 1];

const CHART_T = {
  grid:     { delay: 0.0,  dur: 0.6 },
  axes:     { delay: 0.8,  dur: 0.4 },
  frontier: { delay: 1.1,  dur: 1.4 },
  assets:   { delay: 1.6,  stagger: 0.08 },
  cml:      { delay: 2.2,  dur: 0.4 },
  tangency: { delay: 2.5,  dur: 0.4 },
};

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function HeroPage() {
  const skip    = useReducedMotion();
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  const instant = skip || !mounted;

  return (
    <main style={{
      background: '#050507',
      color: '#EDEDEE',
      fontFamily: 'var(--font-sans, system-ui, sans-serif)',
      overflowX: 'hidden',
    }}>
      {/* Responsive overrides — avoids hydration mismatch from JS-based isMobile */}
      <style>{`
        @media (max-width: 767px) {
          .hero-content {
            text-align: center;
            padding-left: 24px !important;
            padding-right: 24px !important;
          }
          .hero-subhead { margin-left: auto; margin-right: auto; }
          .hero-cta     { justify-content: center; }
          .hero-trust   { left: 50% !important; transform: translateX(-50%); white-space: nowrap; }
          .frontier-grid { grid-template-columns: 1fr !important; }
          .frontier-text { max-width: 100% !important; }
          .algo-row { flex-direction: column !important; gap: 6px !important; }
          .algo-row-desc { text-align: left !important; }
        }
      `}</style>

      <Nav instant={instant} />

      {/* ── Hero ── */}
      <section style={{
        position: 'relative',
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        paddingTop: 88,   // clear fixed nav (72) + breathing room
        paddingBottom: 96,
      }}>
        <GhostFrontier skip={!!skip} />

        {/* Text content */}
        <div
          className="hero-content"
          style={{
            position: 'relative',
            zIndex: 10,
            maxWidth: 960,
            paddingLeft: 48,
            paddingRight: 48,
          }}
        >
          {/* Eyebrow */}
          <motion.p
            initial={instant ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.5, delay: 0, ease: EASE }}
            style={{
              fontFamily: 'var(--font-mono, monospace)',
              fontSize: 11,
              fontWeight: 400,
              letterSpacing: '0.15em',
              textTransform: 'uppercase',
              color: '#6B6B73',
              margin: 0,
              marginBottom: 32,
            }}
          >
            Quantitative Portfolio Optimization · MIT Licensed
          </motion.p>

          {/* Headline — five lines, staggered fade-up */}
          <h1 style={{ margin: 0, padding: 0 }}>
            {[
              'Given any set of stocks,',
              'find the allocation',
              'that maximises return',
              'per unit of risk.',
              'Then prove it holds up.',
            ].map((line, i) => (
              <motion.span
                key={i}
                initial={instant ? false : { opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{
                  duration: 0.6,
                  delay: instant ? 0 : i * 0.12,
                  ease: 'easeOut',
                }}
                style={{
                  display: 'block',
                  fontFamily: '"PP Editorial New", var(--font-serif), Georgia, "Times New Roman", serif',
                  fontSize: 'clamp(44px, 5.5vw, 72px)',
                  fontWeight: 400,
                  lineHeight: 1.05,
                  letterSpacing: '-0.02em',
                  color: '#EDEDEE',
                }}
              >
                {line}
              </motion.span>
            ))}
          </h1>

          {/* Subhead */}
          <motion.p
            className="hero-subhead"
            initial={instant ? false : { opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: instant ? 0 : 0.6, ease: EASE }}
            style={{
              marginTop: 40,
              marginBottom: 0,
              fontSize: 18,
              color: '#A1A1A8',
              maxWidth: 520,
              lineHeight: 1.5,
              fontFamily: 'var(--font-sans, system-ui, sans-serif)',
            }}
          >
            A research tool for people who think seriously about portfolio construction.
          </motion.p>

          {/* CTA cluster */}
          <motion.div
            className="hero-cta"
            initial={instant ? false : { opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: instant ? 0 : 0.72, ease: EASE }}
            style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 48 }}
          >
            <Link
              href="/dashboard"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                height: 44,
                padding: '0 24px',
                background: '#3B82F6',
                color: '#fff',
                borderRadius: 8,
                fontSize: 15,
                fontWeight: 500,
                textDecoration: 'none',
                letterSpacing: '-0.01em',
                transition: 'background 100ms',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = '#2563EB'; }}
              onMouseLeave={e => { e.currentTarget.style.background = '#3B82F6'; }}
            >
              Launch app →
            </Link>
            <a
              href="https://github.com/AdityaChauhanX07/port-opt"
              target="_blank"
              rel="noopener noreferrer"
              style={{
                fontSize: 15,
                color: '#A1A1A8',
                textDecoration: 'none',
                borderBottom: '1px solid #2A2A2F',
                paddingBottom: 1,
                transition: 'border-color 100ms, color 100ms',
              }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = '#3A3A42'; e.currentTarget.style.color = '#EDEDEE'; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = '#2A2A2F'; e.currentTarget.style.color = '#A1A1A8'; }}
            >
              View on GitHub ↗
            </a>
          </motion.div>
        </div>

        {/* Trust strip — pinned to bottom of hero */}
        <div
          className="hero-trust"
          style={{ position: 'absolute', bottom: 64, left: 48, zIndex: 10 }}
        >
          <p style={{
            fontFamily: 'var(--font-mono, monospace)',
            fontSize: 12,
            color: '#6B6B73',
            letterSpacing: '0.02em',
            margin: 0,
            whiteSpace: 'nowrap',
          }}>
            6 algorithms&nbsp;&nbsp;·&nbsp;&nbsp;Rust + WASM&nbsp;&nbsp;·&nbsp;&nbsp;Runs in your browser
          </p>
        </div>
      </section>

      <FrontierSection skip={!!skip} />
      <AlgorithmsSection />
      <SpeedSection />
      <SiteFooter />
    </main>
  );
}

// ---------------------------------------------------------------------------
// Ghost frontier — full-viewport SVG, z-index 0, barely visible atmosphere
// ---------------------------------------------------------------------------

function GhostFrontier({ skip }: { skip: boolean }) {
  return (
    <svg
      viewBox="0 0 1440 900"
      preserveAspectRatio="xMidYMid slice"
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        zIndex: 0,
        pointerEvents: 'none',
      }}
      aria-hidden
    >
      <motion.g
        animate={skip ? {} : { x: [-20, 20] }}
        transition={
          skip
            ? {}
            : { duration: 12, repeat: Infinity, repeatType: 'reverse', ease: 'easeInOut' }
        }
      >
        <path
          d={GHOST_D}
          stroke="#FFFFFF"
          strokeWidth="1.5"
          strokeOpacity="0.04"
          strokeLinecap="round"
          fill="none"
        />
      </motion.g>
    </svg>
  );
}

// ---------------------------------------------------------------------------
// "The frontier, interactive." section
// ---------------------------------------------------------------------------

function FrontierSection({ skip }: { skip: boolean }) {
  const ref      = useRef<HTMLDivElement>(null);
  const inView   = useInView(ref, { once: true, amount: 0.15 });
  const started  = skip || inView;

  const [fxDone,  setFxDone]  = useState(false);
  const [phase,   setPhase]   = useState(0);
  const gridRef   = useRef<SVGGElement>(null);
  const mouseRef  = useRef({ x: 0, y: 0 });
  const rafRef    = useRef<number | null>(null);

  // Ambient gradient drift — only while section is visible
  useEffect(() => {
    if (skip || !inView) return;
    let id: number;
    const loop = (ts: number) => { setPhase((ts / 12000) % 1); id = requestAnimationFrame(loop); };
    id = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(id);
  }, [skip, inView]);

  // Mouse parallax grid
  useEffect(() => {
    if (skip) return;
    const onMove = (e: MouseEvent) => {
      mouseRef.current = { x: (e.clientX / window.innerWidth - 0.5) * 4, y: (e.clientY / window.innerHeight - 0.5) * 4 };
    };
    window.addEventListener('mousemove', onMove, { passive: true });
    const raf = () => {
      if (gridRef.current) {
        const { x, y } = mouseRef.current;
        gridRef.current.style.transform = `translate(${x.toFixed(2)}px,${y.toFixed(2)}px)`;
      }
      rafRef.current = requestAnimationFrame(raf);
    };
    rafRef.current = requestAnimationFrame(raf);
    return () => {
      window.removeEventListener('mousemove', onMove);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [skip]);

  const p  = skip ? 0 : phase;
  const s1 = `${(0  + p * 30).toFixed(1)}%`;
  const s2 = `${(45 + p * 20).toFixed(1)}%`;
  const s3 = `${Math.min(100, 100 - p * 10).toFixed(1)}%`;

  return (
    <section style={{
      background: '#050507',
      borderTop: '1px solid rgba(255,255,255,0.06)',
      padding: '120px 0',
    }}>
      <div style={{ maxWidth: 1040, margin: '0 auto', padding: '0 32px' }}>
        <div
          ref={ref}
          className="frontier-grid"
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(0, 440px) minmax(0, 1fr)',
            gap: '64px 80px',
            alignItems: 'center',
          }}
        >
          {/* Left: text */}
          <div className="frontier-text">
            <h2 style={{
              fontFamily: '"PP Editorial New", var(--font-serif), Georgia, "Times New Roman", serif',
              fontSize: 36,
              fontWeight: 400,
              letterSpacing: '-0.02em',
              lineHeight: 1.1,
              color: '#EDEDEE',
              margin: 0,
              marginBottom: 20,
            }}>
              The frontier, interactive.
            </h2>
            <p style={{
              fontSize: 16,
              color: '#A1A1A8',
              lineHeight: 1.6,
              margin: 0,
            }}>
              Drag along the curve to find any portfolio on the efficient set. Weights, return, volatility, and Sharpe ratio update in real time at sub-15ms. Overlay HRP, Risk Parity, CVaR, or Robust solutions on the same chart to compare approaches.
            </p>
          </div>

          {/* Right: frontier chart — full styling preserved */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={started ? { opacity: 1 } : { opacity: 0 }}
            transition={{ duration: CHART_T.grid.dur, delay: skip ? 0 : CHART_T.grid.delay, ease: EASE }}
            style={{ width: '100%' }}
          >
            <svg
              viewBox={`0 0 ${VB.w} ${VB.h}`}
              style={{ width: '100%', display: 'block', overflow: 'visible' }}
              role="img"
              aria-label="Efficient frontier visualisation"
            >
              <defs>
                <linearGradient id="fg" gradientUnits="userSpaceOnUse" x1={M.l} y1="0" x2={VB.w - M.r} y2="0">
                  <stop offset={s1} stopColor="#3B82F6" />
                  <stop offset={s2} stopColor="#8B5CF6" />
                  <stop offset={s3} stopColor="#EC4899" />
                </linearGradient>
                <radialGradient id="tglow" cx="50%" cy="50%" r="50%">
                  <stop offset="0%"   stopColor="#3B82F6" stopOpacity="0.14" />
                  <stop offset="100%" stopColor="#3B82F6" stopOpacity="0"    />
                </radialGradient>
                <radialGradient id="gfade" cx="50%" cy="50%" r="60%">
                  <stop offset="10%"  stopColor="white" stopOpacity="1" />
                  <stop offset="70%"  stopColor="white" stopOpacity="0.5" />
                  <stop offset="100%" stopColor="white" stopOpacity="0" />
                </radialGradient>
                <mask id="gm"><rect x="0" y="0" width={VB.w} height={VB.h} fill="url(#gfade)" /></mask>
              </defs>

              {/* Parallax grid */}
              <g ref={gridRef} mask="url(#gm)">
                {Array.from({ length: 12 }, (_, i) => (
                  <line key={`v${i}`} x1={i * (VB.w / 11)} y1={0} x2={i * (VB.w / 11)} y2={VB.h}
                    stroke="#1A1A1E" strokeWidth={1} strokeOpacity={0.08} />
                ))}
                {Array.from({ length: 9 }, (_, i) => (
                  <line key={`h${i}`} x1={0} y1={i * (VB.h / 8)} x2={VB.w} y2={i * (VB.h / 8)}
                    stroke="#1A1A1E" strokeWidth={1} strokeOpacity={0.08} />
                ))}
              </g>

              {/* Tangency glow */}
              <ellipse cx={TX} cy={TY} rx="160" ry="120" fill="url(#tglow)" />

              {/* Axes */}
              <motion.path d={X_AXIS} stroke="#2A2A2F" strokeWidth={1} fill="none"
                initial={{ pathLength: 0 }}
                animate={started ? { pathLength: 1 } : { pathLength: 0 }}
                transition={{ duration: CHART_T.axes.dur, delay: skip ? 0 : CHART_T.axes.delay, ease: EASE }} />
              <motion.path d={Y_AXIS} stroke="#2A2A2F" strokeWidth={1} fill="none"
                initial={{ pathLength: 0 }}
                animate={started ? { pathLength: 1 } : { pathLength: 0 }}
                transition={{ duration: CHART_T.axes.dur, delay: skip ? 0 : CHART_T.axes.delay, ease: EASE }} />
              <text x={VB.w - M.r - 2} y={VB.h - M.b + 14} textAnchor="end"
                fill="#6B6B73" fontSize={10} fontFamily="var(--font-mono,monospace)">VOLATILITY →</text>
              <text x={M.l + 4} y={M.t + 2} textAnchor="start"
                fill="#6B6B73" fontSize={10} fontFamily="var(--font-mono,monospace)">RETURN ↑</text>

              {/* Frontier curve */}
              <motion.path
                d={FRONTIER_D} fill="none" stroke="url(#fg)" strokeWidth={2.5}
                strokeLinecap="round" strokeLinejoin="round"
                style={{ vectorEffect: 'non-scaling-stroke' } as React.CSSProperties}
                initial={{
                  strokeDasharray: `${FRONTIER_LEN} ${FRONTIER_LEN}`,
                  strokeDashoffset: FRONTIER_LEN,
                }}
                animate={started ? {
                  strokeDasharray: `${FRONTIER_LEN} ${FRONTIER_LEN}`,
                  strokeDashoffset: 0,
                } : {}}
                transition={{ duration: CHART_T.frontier.dur, delay: skip ? 0 : CHART_T.frontier.delay, ease: EASE }}
                onAnimationComplete={() => setFxDone(true)}
              />

              {/* CML — renders after frontier completes */}
              {(skip || fxDone) && (
                <motion.path d={CML_D} fill="none" stroke="#3A3A42" strokeWidth={1} strokeDasharray="4 6"
                  initial={{ pathLength: 0 }} animate={{ pathLength: 1 }}
                  transition={{ duration: CHART_T.cml.dur, ease: EASE }} />
              )}

              {/* Asset diamonds */}
              {ASSETS.map(([label, risk, ret, color], idx) => {
                const [ax, ay] = toSVG(risk, ret);
                return (
                  <motion.g key={label}
                    initial={{ opacity: 0, scale: 0 }}
                    animate={started ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 0 }}
                    transition={{ duration: 0.25, delay: skip ? 0 : CHART_T.assets.delay + idx * CHART_T.assets.stagger, ease: EASE }}
                    style={{ transformOrigin: `${ax}px ${ay}px` } as React.CSSProperties}
                  >
                    <rect x={ax - 5.5} y={ay - 5.5} width={11} height={11} rx={1}
                      fill={color} fillOpacity={0.85}
                      stroke="rgba(255,255,255,0.22)" strokeWidth={1}
                      transform={`rotate(45,${ax},${ay})`} />
                    <text
                      x={ax < VB.w - M.r - 60 ? ax + 12 : ax - 12}
                      y={ay + 4}
                      textAnchor={ax < VB.w - M.r - 60 ? 'start' : 'end'}
                      fill="#A1A1A8" fontSize={10} fontFamily="var(--font-mono,monospace)" letterSpacing="0.03em"
                    >{label}</text>
                  </motion.g>
                );
              })}

              {/* Tangency portfolio */}
              <motion.g
                initial={{ opacity: 0, scale: 0 }}
                animate={started ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 0 }}
                transition={{ duration: CHART_T.tangency.dur, delay: skip ? 0 : CHART_T.tangency.delay, ease: OVERSHOOT }}
                style={{ transformOrigin: `${TX}px ${TY}px` } as React.CSSProperties}
              >
                <motion.circle cx={TX} cy={TY} r={22}
                  fill="none" stroke="#3B82F6" strokeWidth={1.5} strokeOpacity={0.25}
                  animate={started ? { r: [22, 34, 22], opacity: [0.35, 0, 0.35] } : {}}
                  transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut' }} />
                <circle cx={TX} cy={TY} r={7} fill="#3B82F6" stroke="rgba(0,0,0,0.5)" strokeWidth={1.5} />
                <text x={TX + 12} y={TY - 8} fill="#EDEDEE" fontSize={10}
                  fontFamily="var(--font-mono,monospace)" fontWeight={600}>Max Sharpe</text>
              </motion.g>
            </svg>
          </motion.div>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Nav
// ---------------------------------------------------------------------------

function Nav({ instant }: { instant: boolean }) {
  return (
    <motion.nav
      initial={instant ? false : { opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: instant ? 0 : 0.1, ease: EASE }}
      style={{
        position: 'fixed', top: 0, left: 0, right: 0, height: 72,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 32px', zIndex: 50,
        backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)',
        borderBottom: '1px solid rgba(255,255,255,0.04)',
      }}
    >
      <Logo size={24} style={{ color: '#EDEDEE' }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 28 }}>
        <a href="#features" style={{ fontSize: 13, color: '#A1A1A8', textDecoration: 'none', fontWeight: 500 }}
          onMouseEnter={e => { e.currentTarget.style.color = '#EDEDEE'; }}
          onMouseLeave={e => { e.currentTarget.style.color = '#A1A1A8'; }}>
          Features
        </a>
        <a href="https://github.com/AdityaChauhanX07/port-opt" target="_blank" rel="noopener noreferrer"
          style={{ fontSize: 13, color: '#A1A1A8', textDecoration: 'none', fontWeight: 500 }}
          onMouseEnter={e => { e.currentTarget.style.color = '#EDEDEE'; }}
          onMouseLeave={e => { e.currentTarget.style.color = '#A1A1A8'; }}>
          GitHub
        </a>
        <Link
          href="/dashboard"
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            height: 34, padding: '0 16px',
            background: '#2563EB', color: '#fff',
            borderRadius: 6, fontSize: 13, fontWeight: 500, textDecoration: 'none',
            transition: 'background 100ms',
          }}
          onMouseEnter={e => { e.currentTarget.style.background = '#1D4ED8'; }}
          onMouseLeave={e => { e.currentTarget.style.background = '#2563EB'; }}
        >
          Launch app →
        </Link>
      </div>
    </motion.nav>
  );
}

// ---------------------------------------------------------------------------
// Below fold — preserved as-is; the frontier chart moves here in step 2
// ---------------------------------------------------------------------------

const ALGO_TABLE = [
  { name: 'Markowitz MVO',          desc: 'The starting point. Traces the full efficient frontier via mean-variance optimisation.' },
  { name: 'Hierarchical Risk Parity', desc: 'When you have many assets or short history. Clusters the correlation matrix instead of inverting it.' },
  { name: 'Equal Risk Contribution', desc: 'Defensive allocation across mixed asset classes. Each asset contributes equally to variance.' },
  { name: 'CVaR Minimisation',       desc: 'When tail risk matters more than average risk. Minimises expected loss in the worst 5%.' },
  { name: 'Robust MVO',              desc: 'Conservative and real-world oriented. Holds up even when your return estimates are wrong.' },
  { name: 'Black-Litterman',         desc: 'When you have conviction but want the math to keep you honest. Blends equilibrium with your subjective views.' },
];

// ---------------------------------------------------------------------------
// "Six algorithms." section
// ---------------------------------------------------------------------------

function AlgoRow({ name, desc, isLast }: { name: string; desc: string; isLast: boolean }) {
  const [hover, setHover] = useState(false);
  return (
    <div
      className="algo-row"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'flex',
        alignItems: 'baseline',
        justifyContent: 'space-between',
        gap: 40,
        padding: '24px 16px',
        margin: '0 -16px',
        borderBottom: isLast ? 'none' : '1px solid #1F1F23',
        background: hover ? '#0F0F12' : 'transparent',
        transition: 'background 150ms ease',
        cursor: 'default',
      }}
    >
      <span style={{
        fontFamily: '"PP Editorial New", var(--font-serif), Georgia, "Times New Roman", serif',
        fontSize: 22,
        fontWeight: 400,
        letterSpacing: '-0.01em',
        color: '#EDEDEE',
        flexShrink: 0,
      }}>
        {name}
      </span>
      <span
        className="algo-row-desc"
        style={{
          fontSize: 14,
          color: '#A1A1A8',
          lineHeight: 1.5,
          textAlign: 'right',
        }}
      >
        {desc}
      </span>
    </div>
  );
}

function AlgorithmsSection() {
  const ref   = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.1 });
  return (
    <section style={{
      background: '#050507',
      borderTop: '1px solid rgba(255,255,255,0.06)',
      padding: '120px 0',
    }}>
      <div
        ref={ref}
        style={{ maxWidth: 1040, margin: '0 auto', padding: '0 32px' }}
      >
        <motion.div
          initial={{ opacity: 0 }}
          animate={inView ? { opacity: 1 } : { opacity: 0 }}
          transition={{ duration: 0.5, ease: EASE }}
          style={{ borderTop: '1px solid #1F1F23' }}
        >
          {ALGO_TABLE.map((row, i) => (
            <AlgoRow
              key={row.name}
              name={row.name}
              desc={row.desc}
              isLast={i === ALGO_TABLE.length - 1}
            />
          ))}
        </motion.div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// "Built for speed." section
// ---------------------------------------------------------------------------

const SECONDARY_STATS = [
  { num: '<5ms',   label: 'Monte Carlo, 500 paths' },
  { num: '~100ms', label: 'Walk-forward backtest, 5yr' },
  { num: '60fps',  label: 'Frontier drag interaction' },
];

function SpeedSection() {
  const ref    = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.2 });
  return (
    <section style={{
      background: '#050507',
      borderTop: '1px solid rgba(255,255,255,0.06)',
      padding: '120px 0',
      textAlign: 'center',
    }}>
      <motion.div
        ref={ref}
        initial={{ opacity: 0, y: 16 }}
        animate={inView ? { opacity: 1, y: 0 } : { opacity: 0, y: 16 }}
        transition={{ duration: 0.55, ease: EASE }}
        style={{ maxWidth: 640, margin: '0 auto', padding: '0 32px' }}
      >
        {/* Section heading */}
        <h2 style={{
          fontFamily: '"PP Editorial New", var(--font-serif), Georgia, "Times New Roman", serif',
          fontSize: 36,
          fontWeight: 400,
          letterSpacing: '-0.02em',
          color: '#EDEDEE',
          margin: 0,
          marginBottom: 56,
          lineHeight: 1.1,
        }}>
          Built for speed.
        </h2>

        {/* Primary stat */}
        <p style={{
          fontFamily: 'var(--font-mono, monospace)',
          fontSize: 48,
          fontWeight: 400,
          color: '#EDEDEE',
          margin: 0,
          letterSpacing: '-0.02em',
          lineHeight: 1,
        }}>
          &lt;15ms
        </p>
        <p style={{
          fontFamily: 'var(--font-sans, system-ui, sans-serif)',
          fontSize: 13,
          color: '#6B6B73',
          margin: '10px 0 0',
          letterSpacing: '0.01em',
        }}>
          per efficient frontier, 6 assets, 5yr daily data
        </p>

        {/* Secondary stats row */}
        <div style={{
          display: 'flex',
          justifyContent: 'center',
          gap: 64,
          marginTop: 56,
          flexWrap: 'wrap',
        }}>
          {SECONDARY_STATS.map(({ num, label }) => (
            <div key={num}>
              <p style={{
                fontFamily: 'var(--font-mono, monospace)',
                fontSize: 32,
                fontWeight: 400,
                color: '#EDEDEE',
                margin: 0,
                letterSpacing: '-0.02em',
                lineHeight: 1,
              }}>
                {num}
              </p>
              <p style={{
                fontFamily: 'var(--font-sans, system-ui, sans-serif)',
                fontSize: 12,
                color: '#6B6B73',
                margin: '8px 0 0',
                letterSpacing: '0.01em',
              }}>
                {label}
              </p>
            </div>
          ))}
        </div>
      </motion.div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Footer
// ---------------------------------------------------------------------------

function SiteFooter() {
  return (
    <footer style={{
      background: '#050507',
      padding: '80px 32px',
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
    }}>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        flexWrap: 'wrap',
        justifyContent: 'center',
        color: '#6B6B73',
        fontFamily: 'var(--font-sans, system-ui, sans-serif)',
        fontSize: 14,
      }}>
        <span style={{ fontSize: 24, fontWeight: 600, letterSpacing: '-0.01em', color: '#6B6B73' }}>
          PortOpt
        </span>
        <Mid />
        <a
          href="https://github.com/AdityaChauhanX07/port-opt"
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: '#6B6B73', textDecoration: 'none', transition: 'color 120ms' }}
          onMouseEnter={e => { e.currentTarget.style.color = '#A1A1A8'; }}
          onMouseLeave={e => { e.currentTarget.style.color = '#6B6B73'; }}
        >
          GitHub
        </a>
        <Mid />
        <span>MIT licensed</span>
        <Mid />
        <span>© 2026</span>
      </div>
    </footer>
  );
}

function Mid() {
  return (
    <span aria-hidden style={{
      display: 'inline-block',
      width: 3,
      height: 3,
      borderRadius: '50%',
      background: '#3A3A42',
      flexShrink: 0,
      verticalAlign: 'middle',
    }} />
  );
}

