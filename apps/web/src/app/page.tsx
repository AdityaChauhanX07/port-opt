'use client';

import React, { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { motion, useReducedMotion } from 'framer-motion';

// ---------------------------------------------------------------------------
// Frontier geometry — 680×380 viewBox, normalised [0,1] risk/return space
// ---------------------------------------------------------------------------

const VB = { w: 680, h: 380 };
const M  = { t: 40, r: 40, b: 50, l: 60 };
const IW = VB.w - M.l - M.r;
const IH = VB.h - M.t - M.b;

function toSVG(risk: number, ret: number): [number, number] {
  return [M.l + risk * IW, VB.h - M.b - ret * IH];
}

function buildFrontier(n = 80): string {
  let d = '';
  for (let i = 0; i <= n; i++) {
    const t    = i / n;
    const risk = 0.09 + 0.60 * t;
    const ret  = 0.08 + 0.88 * t - 0.28 * t * t;
    const [x, y] = toSVG(risk, ret);
    d += `${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)} `;
  }
  return d.trim();
}

function estimateLen(n = 80): number {
  let len = 0, prev: [number,number] | null = null;
  for (let i = 0; i <= n; i++) {
    const t    = i / n;
    const risk = 0.09 + 0.60 * t;
    const ret  = 0.08 + 0.88 * t - 0.28 * t * t;
    const cur  = toSVG(risk, ret);
    if (prev) len += Math.hypot(cur[0]-prev[0], cur[1]-prev[1]);
    prev = cur;
  }
  return len;
}

const FRONTIER_D   = buildFrontier();
const FRONTIER_LEN = estimateLen();

const TX_N = 0.38, TY_N = 0.685;
const [TX, TY] = toSVG(TX_N, TY_N);

const RF_RET = 0.045;
const [, RFY] = toSVG(0, RF_RET);
const slope   = (TY_N - RF_RET) / TX_N;
const CML_X2  = M.l + IW;
const CML_Y2  = VB.h - M.b - (RF_RET + slope * 1.0) * IH;
const CML_D   = `M${M.l},${RFY.toFixed(1)} L${CML_X2},${CML_Y2.toFixed(1)}`;
const X_AXIS  = `M${M.l},${VB.h-M.b} L${VB.w-M.r},${VB.h-M.b}`;
const Y_AXIS  = `M${M.l},${M.t} L${M.l},${VB.h-M.b}`;

const ASSETS: [string, number, number, string][] = [
  ['SPY',  0.18, 0.38, '#3B82F6'],
  ['QQQ',  0.24, 0.46, '#8B5CF6'],
  ['AAPL', 0.32, 0.58, '#EC4899'],
  ['MSFT', 0.28, 0.52, '#6366F1'],
  ['GLD',  0.12, 0.20, '#F59E0B'],
  ['TLT',  0.09, 0.12, '#10B981'],
  ['IWM',  0.22, 0.42, '#06B6D4'],
];

// Easing tuple type framer-motion expects
type Easing4 = [number, number, number, number];
const EASE: Easing4 = [0.2, 0, 0, 1];
const OVERSHOOT: Easing4 = [0.34, 1.56, 0.64, 1];

const T = {
  grid:     { delay: 0.0, dur: 0.6 },
  copy:     { delay: 0.3, dur: 0.5 },
  axes:     { delay: 0.8, dur: 0.4 },
  frontier: { delay: 1.1, dur: 1.4 },
  assets:   { delay: 1.6, stagger: 0.08 },
  cml:      { delay: 2.2, dur: 0.4 },
  tangency: { delay: 2.5, dur: 0.4 },
  cta:      { delay: 2.9, dur: 0.4 },
  trust:    { delay: 3.3, dur: 0.3 },
};

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function HeroPage() {
  const skip = useReducedMotion();
  const [mounted,  setMounted]  = useState(false);
  const [fxDone,   setFxDone]   = useState(false);
  const [phase,    setPhase]    = useState(0);
  const mouseRef  = useRef({ x: 0, y: 0 });
  const gridRef   = useRef<SVGGElement>(null);
  const rafRef    = useRef<number | null>(null);

  useEffect(() => { setMounted(true); }, []);

  // Ambient gradient drift — 12 s cycle
  useEffect(() => {
    if (skip) return;
    let id: number;
    const loop = (ts: number) => { setPhase((ts / 12000) % 1); id = requestAnimationFrame(loop); };
    id = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(id);
  }, [skip]);

  // Mouse parallax grid
  useEffect(() => {
    if (skip) return;
    const onMove = (e: MouseEvent) => {
      mouseRef.current = { x: (e.clientX/window.innerWidth-0.5)*4, y: (e.clientY/window.innerHeight-0.5)*4 };
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
    return () => { window.removeEventListener('mousemove', onMove); if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [skip]);

  const instant = skip || !mounted;
  const p = skip ? 0 : phase;
  const s1 = `${(0  + p*30).toFixed(1)}%`;
  const s2 = `${(45 + p*20).toFixed(1)}%`;
  const s3 = `${Math.min(100, 100-p*10).toFixed(1)}%`;

  return (
    <main style={{
      minHeight: '100vh',
      background: 'radial-gradient(ellipse 130% 90% at 50% 45%, #0F0F14 0%, #050507 100%)',
      color: '#EDEDEE', fontFamily: 'var(--font-sans,system-ui,sans-serif)', overflowX: 'hidden',
    }}>
      <Nav instant={instant} />

      <section style={{
        minHeight: '100vh', display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', padding: '100px 24px 48px',
      }}>
        <Copy instant={instant} />

        {/* ── Frontier SVG ── */}
        <motion.div
          initial={instant ? false : { opacity: 0 }} animate={{ opacity: 1 }}
          transition={{ duration: T.grid.dur, delay: instant ? 0 : T.grid.delay }}
          style={{ width: '100%', maxWidth: 680 }}
        >
          <svg viewBox={`0 0 ${VB.w} ${VB.h}`}
            style={{ width: '100%', display: 'block', overflow: 'visible' }}
            role="img" aria-label="Efficient frontier visualisation"
          >
            <defs>
              <linearGradient id="fg" gradientUnits="userSpaceOnUse" x1={M.l} y1="0" x2={VB.w-M.r} y2="0">
                <stop offset={s1} stopColor="#3B82F6" />
                <stop offset={s2} stopColor="#8B5CF6" />
                <stop offset={s3} stopColor="#EC4899" />
              </linearGradient>
              <radialGradient id="tglow" cx="50%" cy="50%" r="50%">
                <stop offset="0%"   stopColor="#3B82F6" stopOpacity="0.16" />
                <stop offset="100%" stopColor="#3B82F6" stopOpacity="0"    />
              </radialGradient>
              <radialGradient id="gfade" cx="50%" cy="50%" r="55%">
                <stop offset="20%"  stopColor="white" stopOpacity="1" />
                <stop offset="100%" stopColor="white" stopOpacity="0" />
              </radialGradient>
              <mask id="gm"><rect x="0" y="0" width={VB.w} height={VB.h} fill="url(#gfade)" /></mask>
            </defs>

            {/* Grid — parallaxes with mouse */}
            <g ref={gridRef} mask="url(#gm)">
              {Array.from({length:10},(_,i)=><line key={`v${i}`} x1={i*(VB.w/9)} y1={0} x2={i*(VB.w/9)} y2={VB.h} stroke="#1F1F23" strokeWidth={1}/>)}
              {Array.from({length:8}, (_,i)=><line key={`h${i}`} x1={0} y1={i*(VB.h/7)} x2={VB.w} y2={i*(VB.h/7)} stroke="#1F1F23" strokeWidth={1}/>)}
            </g>

            {/* Tangency accent glow */}
            <ellipse cx={TX} cy={TY} rx="130" ry="100" fill="url(#tglow)" />

            {/* Axes */}
            <motion.path d={X_AXIS} stroke="#2A2A2F" strokeWidth={1} fill="none"
              initial={instant ? false : {pathLength:0}} animate={{pathLength:1}}
              transition={{duration:T.axes.dur,delay:instant?0:T.axes.delay,ease:EASE}}/>
            <motion.path d={Y_AXIS} stroke="#2A2A2F" strokeWidth={1} fill="none"
              initial={instant ? false : {pathLength:0}} animate={{pathLength:1}}
              transition={{duration:T.axes.dur,delay:instant?0:T.axes.delay,ease:EASE}}/>
            <text x={VB.w-M.r-2} y={VB.h-M.b+14} textAnchor="end"  fill="#6B6B73" fontSize={10} fontFamily="var(--font-mono,monospace)">VOLATILITY →</text>
            <text x={M.l+4}      y={M.t+2}        textAnchor="start" fill="#6B6B73" fontSize={10} fontFamily="var(--font-mono,monospace)">RETURN ↑</text>

            {/* Frontier */}
            <motion.path
              d={FRONTIER_D} fill="none" stroke="url(#fg)" strokeWidth={2.5}
              strokeLinecap="round" strokeLinejoin="round"
              style={{vectorEffect:'non-scaling-stroke'} as React.CSSProperties}
              initial={instant ? false : {
                strokeDasharray:`${FRONTIER_LEN} ${FRONTIER_LEN}`,
                strokeDashoffset:FRONTIER_LEN,
              }}
              animate={{strokeDasharray:`${FRONTIER_LEN} ${FRONTIER_LEN}`,strokeDashoffset:0}}
              transition={{duration:T.frontier.dur,delay:instant?0:T.frontier.delay,ease:EASE}}
              onAnimationComplete={()=>setFxDone(true)}
            />

            {/* CML — renders after frontier completes */}
            {(instant||fxDone) && (
              <motion.path d={CML_D} fill="none" stroke="#3A3A42" strokeWidth={1} strokeDasharray="4 6"
                initial={instant ? false : {pathLength:0}} animate={{pathLength:1}}
                transition={{duration:T.cml.dur,delay:instant?0:0,ease:EASE}}/>
            )}

            {/* Asset diamonds */}
            {ASSETS.map(([label,risk,ret,color],idx)=>{
              const [ax,ay] = toSVG(risk,ret);
              return (
                <motion.g key={label}
                  initial={instant ? false : {opacity:0,scale:0}} animate={{opacity:1,scale:1}}
                  transition={{duration:0.25,delay:instant?0:T.assets.delay+idx*T.assets.stagger,ease:EASE}}
                  style={{transformOrigin:`${ax}px ${ay}px`} as React.CSSProperties}
                >
                  <rect x={ax-5.5} y={ay-5.5} width={11} height={11} rx={1}
                    fill={color} fillOpacity={0.82}
                    stroke="rgba(255,255,255,0.2)" strokeWidth={1}
                    transform={`rotate(45,${ax},${ay})`}/>
                  <text x={ax<VB.w*0.78?ax+10:ax-10} y={ay+4}
                    textAnchor={ax<VB.w*0.78?'start':'end'}
                    fill="#A1A1A8" fontSize={10} fontFamily="var(--font-mono,monospace)"
                  >{label}</text>
                </motion.g>
              );
            })}

            {/* Tangency portfolio */}
            <motion.g
              initial={instant ? false : {opacity:0,scale:0}} animate={{opacity:1,scale:1}}
              transition={{duration:T.tangency.dur,delay:instant?0:T.tangency.delay,ease:OVERSHOOT}}
              style={{transformOrigin:`${TX}px ${TY}px`} as React.CSSProperties}
            >
              <motion.circle cx={TX} cy={TY} r={22}
                fill="none" stroke="#3B82F6" strokeWidth={1.5} strokeOpacity={0.25}
                animate={{r:[22,34,22],opacity:[0.35,0,0.35]}}
                transition={{duration:2.4,repeat:Infinity,ease:'easeInOut'}}/>
              <circle cx={TX} cy={TY} r={7} fill="#3B82F6" stroke="rgba(0,0,0,0.5)" strokeWidth={1.5}/>
              <text x={TX+12} y={TY-8} fill="#EDEDEE" fontSize={10} fontFamily="var(--font-mono,monospace)" fontWeight={600}>Max Sharpe</text>
            </motion.g>
          </svg>
        </motion.div>

        <CTACluster instant={instant}/>
        <TrustStrip instant={instant}/>
      </section>

      <BelowFold />
    </main>
  );
}

// ---------------------------------------------------------------------------
// Nav
// ---------------------------------------------------------------------------
function Nav({ instant }: { instant: boolean }) {
  return (
    <motion.nav
      initial={instant ? false : {opacity:0,y:-10}} animate={{opacity:1,y:0}}
      transition={{duration:0.5,delay:instant?0:0.1,ease:EASE}}
      style={{
        position:'fixed',top:0,left:0,right:0,height:72,
        display:'flex',alignItems:'center',justifyContent:'space-between',padding:'0 32px',
        zIndex:50,backdropFilter:'blur(12px)',WebkitBackdropFilter:'blur(12px)',
        borderBottom:'1px solid rgba(255,255,255,0.04)',
      }}
    >
      <div style={{display:'flex',alignItems:'center',gap:8,userSelect:'none'}}>
        <span style={{width:6,height:6,borderRadius:1,background:'#3B82F6',display:'inline-block'}}/>
        <span style={{fontSize:15,fontWeight:600,color:'#EDEDEE',letterSpacing:'-0.01em'}}>PortOpt</span>
      </div>
      <div style={{display:'flex',alignItems:'center',gap:28}}>
        <a href="#features" style={{fontSize:13,color:'#A1A1A8',textDecoration:'none',fontWeight:500}}
          onMouseEnter={e=>e.currentTarget.style.color='#EDEDEE'}
          onMouseLeave={e=>e.currentTarget.style.color='#A1A1A8'}>Features</a>
        <a href="https://github.com" target="_blank" rel="noopener noreferrer"
          style={{fontSize:13,color:'#A1A1A8',textDecoration:'none',fontWeight:500}}
          onMouseEnter={e=>e.currentTarget.style.color='#EDEDEE'}
          onMouseLeave={e=>e.currentTarget.style.color='#A1A1A8'}>GitHub</a>
        <Link href="/dashboard"
          style={{
            display:'inline-flex',alignItems:'center',gap:6,height:34,padding:'0 16px',
            background:'#2563EB',color:'#fff',borderRadius:6,fontSize:13,fontWeight:500,textDecoration:'none',
          }}
          onMouseEnter={e=>e.currentTarget.style.background='#1D4ED8'}
          onMouseLeave={e=>e.currentTarget.style.background='#2563EB'}
        >Launch app →</Link>
      </div>
    </motion.nav>
  );
}

// ---------------------------------------------------------------------------
// Copy
// ---------------------------------------------------------------------------
function Copy({ instant }: { instant: boolean }) {
  const base = instant ? 0 : T.copy.delay;
  const stg  = instant ? 0 : 0.09;
  return (
    <div style={{textAlign:'center',marginBottom:28,maxWidth:640,width:'100%'}}>
      <motion.p initial={instant?false:{opacity:0,y:16}} animate={{opacity:1,y:0}}
        transition={{duration:T.copy.dur,delay:base,ease:EASE}}
        style={{fontFamily:'var(--font-mono,monospace)',fontSize:11,fontWeight:500,
          letterSpacing:'0.15em',textTransform:'uppercase',color:'#6B6B73',marginBottom:20}}>
        Quantitative Portfolio Optimization
      </motion.p>
      <motion.div initial={instant?false:{opacity:0,y:16}} animate={{opacity:1,y:0}}
        transition={{duration:T.copy.dur,delay:base+stg,ease:EASE}}
        style={{position:'relative',display:'inline-block',marginBottom:20}}>
        <span aria-hidden style={{
          position:'absolute',inset:'-24px -48px',
          background:'radial-gradient(ellipse at center, rgba(255,255,255,0.05) 0%, transparent 70%)',
          filter:'blur(28px)',pointerEvents:'none',
        }}/>
        <h1 style={{
          fontFamily:'Georgia, "Times New Roman", serif',
          fontSize:'clamp(52px,10vw,88px)',fontWeight:400,letterSpacing:'-0.03em',
          lineHeight:1,color:'#EDEDEE',margin:0,position:'relative',
        }}>PortOpt</h1>
      </motion.div>
      <motion.p initial={instant?false:{opacity:0,y:16}} animate={{opacity:1,y:0}}
        transition={{duration:T.copy.dur,delay:base+stg*2,ease:EASE}}
        style={{fontSize:17,color:'#A1A1A8',lineHeight:1.6,maxWidth:520,margin:'0 auto'}}>
        Build, test, and analyse institutional-quality portfolios.
      </motion.p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// CTA
// ---------------------------------------------------------------------------
function CTACluster({ instant }: { instant: boolean }) {
  return (
    <motion.div initial={instant?false:{opacity:0,y:12}} animate={{opacity:1,y:0}}
      transition={{duration:T.cta.dur,delay:instant?0:T.cta.delay,ease:EASE}}
      style={{display:'flex',alignItems:'center',gap:12,marginTop:36}}>
      <Link href="/dashboard"
        style={{
          display:'inline-flex',alignItems:'center',gap:8,height:44,padding:'0 24px',
          background:'#2563EB',color:'#fff',borderRadius:8,fontSize:14,fontWeight:600,
          textDecoration:'none',letterSpacing:'-0.01em',
          boxShadow:'0 0 0 1px rgba(37,99,235,0.4), 0 4px 16px rgba(37,99,235,0.22)',
          transition:'background 100ms,transform 100ms',
        }}
        onMouseEnter={e=>{e.currentTarget.style.background='#1D4ED8';e.currentTarget.style.transform='translateY(-1px)';}}
        onMouseLeave={e=>{e.currentTarget.style.background='#2563EB';e.currentTarget.style.transform='none';}}
      >Launch app<ArrowRight/></Link>
      <a href="https://github.com" target="_blank" rel="noopener noreferrer"
        style={{
          display:'inline-flex',alignItems:'center',gap:8,height:44,padding:'0 24px',
          background:'transparent',border:'1px solid rgba(255,255,255,0.14)',color:'#A1A1A8',
          borderRadius:8,fontSize:14,fontWeight:500,textDecoration:'none',
          transition:'border-color 100ms,color 100ms,transform 100ms',
        }}
        onMouseEnter={e=>{e.currentTarget.style.borderColor='rgba(255,255,255,0.28)';e.currentTarget.style.color='#EDEDEE';e.currentTarget.style.transform='translateY(-1px)';}}
        onMouseLeave={e=>{e.currentTarget.style.borderColor='rgba(255,255,255,0.14)';e.currentTarget.style.color='#A1A1A8';e.currentTarget.style.transform='none';}}
      ><GitHubMark/>View on GitHub</a>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Trust
// ---------------------------------------------------------------------------
function TrustStrip({ instant }: { instant: boolean }) {
  return (
    <motion.p initial={instant?false:{opacity:0}} animate={{opacity:1}}
      transition={{duration:T.trust.dur,delay:instant?0:T.trust.delay}}
      style={{fontFamily:'var(--font-mono,monospace)',fontSize:12,color:'#6B6B73',marginTop:20,letterSpacing:'0.02em'}}>
      6 algorithms&nbsp;&nbsp;·&nbsp;&nbsp;Rust + WASM&nbsp;&nbsp;·&nbsp;&nbsp;MIT licensed
    </motion.p>
  );
}

// ---------------------------------------------------------------------------
// Below fold
// ---------------------------------------------------------------------------
const ALGOS = ['Markowitz MVO','Hierarchical Risk Parity','Equal Risk Contribution','CVaR Minimisation','Robust MVO','Black-Litterman'];

const FEATS = [
  {icon:'↗',title:'Efficient Frontier',  body:'Compute the full Markowitz frontier in milliseconds via a Rust WASM engine. Hover to explore every portfolio on the curve.'},
  {icon:'⬡',title:'Risk Analytics',      body:'VaR, CVaR, Monte Carlo simulation, rolling Sharpe, regime detection (HMM), and factor decomposition — all in one panel.'},
  {icon:'↺',title:'Walk-Forward Backtest',body:'Realistic backtests with transaction costs, slippage, OOS splits, and bootstrap Sharpe significance testing.'},
  {icon:'✦',title:'AI Research',          body:'Ask Claude natural-language questions about your portfolio. Context-aware answers grounded in your actual weights and metrics.'},
  {icon:'⊞',title:'6 Algorithms',         body:'Switch between MVO, HRP, ERC, CVaR, Robust MVO, and Black-Litterman with one click. Results update instantly.'},
  {icon:'<>',title:'Open Source',         body:'MIT licensed. Self-host in minutes. Python data service, Rust engine, and Next.js frontend in a single monorepo.'},
];

function BelowFold() {
  return (
    <div id="features">
      {/* Scrolling algo strip */}
      <div style={{borderTop:'1px solid rgba(255,255,255,0.06)',borderBottom:'1px solid rgba(255,255,255,0.06)',overflow:'hidden',padding:'18px 0'}}>
        <motion.div animate={{x:['0%','-50%']}} transition={{duration:28,repeat:Infinity,ease:'linear'}}
          style={{display:'flex',gap:56,whiteSpace:'nowrap',width:'max-content'}}>
          {[...ALGOS,...ALGOS].map((name,i)=>(
            <span key={i} style={{fontFamily:'Georgia,serif',fontSize:22,fontWeight:400,color:'rgba(237,237,238,0.18)',letterSpacing:'-0.02em'}}>{name}</span>
          ))}
        </motion.div>
      </div>

      {/* Feature grid */}
      <div style={{maxWidth:1040,margin:'0 auto',padding:'72px 32px 100px'}}>
        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(280px,1fr))',gap:0,border:'1px solid rgba(255,255,255,0.07)',borderRadius:12,overflow:'hidden'}}>
          {FEATS.map((f,i)=>(
            <motion.div key={f.title}
              initial={{opacity:0,y:20}} whileInView={{opacity:1,y:0}}
              viewport={{once:true,margin:'-50px'}}
              transition={{duration:0.4,delay:(i%3)*0.07,ease:EASE}}
              style={{padding:'28px 28px 32px',background:'rgba(255,255,255,0.015)',borderRight:'1px solid rgba(255,255,255,0.07)',borderBottom:'1px solid rgba(255,255,255,0.07)'}}>
              <div style={{fontSize:16,color:'#6B6B73',marginBottom:14,fontFamily:'var(--font-mono,monospace)'}}>{f.icon}</div>
              <p style={{fontSize:15,fontWeight:600,color:'#EDEDEE',marginBottom:8,letterSpacing:'-0.01em'}}>{f.title}</p>
              <p style={{fontSize:13,color:'#71717A',lineHeight:1.65,margin:0}}>{f.body}</p>
            </motion.div>
          ))}
        </div>

        <div style={{textAlign:'center',marginTop:60}}>
          <Link href="/dashboard"
            style={{
              display:'inline-flex',alignItems:'center',gap:8,height:48,padding:'0 28px',
              background:'#2563EB',color:'#fff',borderRadius:8,fontSize:15,fontWeight:600,
              textDecoration:'none',boxShadow:'0 0 0 1px rgba(37,99,235,0.4), 0 4px 20px rgba(37,99,235,0.28)',
              transition:'background 100ms',
            }}
            onMouseEnter={e=>e.currentTarget.style.background='#1D4ED8'}
            onMouseLeave={e=>e.currentTarget.style.background='#2563EB'}
          >Start optimising your portfolio<ArrowRight/></Link>
          <p style={{fontSize:12,color:'#6B6B73',marginTop:14,fontFamily:'var(--font-mono,monospace)'}}>No sign-up required · Runs entirely in your browser</p>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Icons
// ---------------------------------------------------------------------------
function ArrowRight() {
  return <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M12 5l7 7-7 7"/></svg>;
}
function GitHubMark() {
  return <svg width={16} height={16} viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0 1 12 6.844a9.59 9.59 0 0 1 2.504.337c1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.02 10.02 0 0 0 22 12.017C22 6.484 17.522 2 12 2z"/></svg>;
}
