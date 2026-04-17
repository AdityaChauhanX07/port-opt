# Phase 2 — Complete

## What was built

### /optimize page (Phase 1 carry-over)
- Ticker search with debounced tRPC calls
- Date range + frequency + return model controls
- Efficient frontier (Markowitz) via Rust WASM
- HRP, Risk Parity, CVaR, Robust MVO algorithms
- Interactive frontier chart (D3) — click to select a portfolio point
- Weight bar chart + algorithm cache for instant switching

### /backtest page
- Static and walk-forward backtesting via WASM
- Transaction cost + slippage modelling
- Equity curve, drawdown chart (D3 TimeSeriesLine)
- Stress-period analysis (grouped bar chart)
- Advanced analytics: rolling Sharpe/Sortino, underwater chart, bootstrap CI
- OOS fraction guard for walk-forward mode

### /risk page
- **Section 1** — Risk metrics summary: VaR, CVaR, mean return, skewness with confidence-level slider (instant JS)
- **Section 2** — Monte Carlo fan chart (analytical GBM bands: p5/p25/median/p75/p95) + WASM simulation run + terminal stats
- **Section 3** — Correlation matrix heatmap (D3, click-to-scatter OLS fit) with **3D Correlation Globe** toggle (React Three Fiber, force-directed sphere layout, single LineSegments draw call, hover spring animations, OrbitControls auto-rotate)
- **Section 4** — Rolling Sharpe & Sortino (TimeSeriesLine)
- **Section 5** — Historical stress-period grouped bars
- **Section 6** — Marginal risk contribution horizontal bars
- **Section 7** — Factor exposure (stub)

### /dashboard page
- Time-based greeting with portfolio quick stats
- Recent workspace: ticker pills + algorithm + date range
- Quick-action cards: Optimize / Backtest / Risk Analysis
- Market snapshot strip: SPY, QQQ, DIA, IWM, TLT, GLD, DBC, VIX with sparklines and 1-day % change; horizontal scroll with arrow controls
- Saved portfolios stub

### App-wide polish
- Landing page (`/`) with "Launch app →" button
- framer-motion page transitions (180ms fade)
- Responsive guard (< 1024 px shows overlay)
- Skeleton animation CSS + `.no-scrollbar` utility
- `:focus-visible` focus ring (2 px accent, 2 px offset)
- Error banner with dismiss in market snapshot
- `--warn` design token added

### New packages / components
| Location | Component |
|---|---|
| `packages/charts/src/MonteCarloFan.tsx` | Analytical GBM fan chart |
| `packages/charts/src/CorrelationMatrix.tsx` | D3 heatmap + scatter |
| `packages/charts/src/TimeSeriesLine.tsx` | Generic multi-series line |
| `packages/three/src/CorrelationGlobe.tsx` | React Three Fiber globe |

### Backend additions
| Route | Description |
|---|---|
| `GET /market-snapshot` | SPY/QQQ/DIA/IWM/TLT/GLD/DBC/VIX last 30 days |

### tRPC additions
| Procedure | Description |
|---|---|
| `api.data.marketSnapshot` | Proxies `/market-snapshot`, 5-min stale time |

## Known issues / TODOs

- **Auth** — No authentication yet. Pages are open. Auth is Phase 3.
- **Saved portfolios** — Database and persistence not implemented. Stub only.
- **Factor exposure** — `/risk` Section 7 is a placeholder.
- **Research page** — Navigation item exists, page not built.
- **Mobile** — Responsive guard shown at < 1024 px; no mobile-optimised layout.
- **WASM cold start** — First WASM call has ~200 ms latency; subsequent calls are fast.
- **Data service offline** — Market snapshot shows dismissable error banner; other pages show empty-state links to /optimize.

## Performance notes

- D3 charts use `ResizeObserver` + full SVG redraw on data change; expensive for > 30 assets.
- Correlation globe force-layout runs 50 spring iterations at mount time; deterministic (seeded LCG).
- WASM module is loaded once per session via module-level worker singleton.
- Market snapshot has 5-min server-side `next: { revalidate: 300 }` cache + 5-min TanStack Query `staleTime`.
