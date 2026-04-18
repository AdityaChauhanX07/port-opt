# PortOpt

**Given any set of stocks, find the allocation that maximises return per unit of risk. Then prove it holds up. Then ask AI what it thinks.**

[![License: MIT](https://img.shields.io/badge/License-MIT-c8502a?style=flat-square)](LICENSE)

---

## What this is

A portfolio optimization tool that runs in the browser. You give it tickers, it pulls market data, runs the math, and shows you exactly how to allocate your money across those assets for the best risk-adjusted return. Then it backtests the allocation against real market history so you can see if the theory survives contact with reality.

The computation happens client-side through a Rust engine compiled to WebAssembly. The efficient frontier, Monte Carlo simulations, walk-forward backtests, regime detection: all of it runs in your browser at native speed. No waiting for a server to crunch numbers.

This is not a trading platform. It is a research tool for people who want to think seriously about portfolio construction.

## Why it exists

v1 was a Python/Streamlit app. It worked, but everything was slow. Every optimization required a server round-trip. The UI was a Streamlit widget tree. You could not drag along the efficient frontier and watch weights update in real-time because the architecture made that impossible.

v2 rewrites the entire computational core in Rust, compiles it to WASM, and runs it in the browser. The frontend is Next.js with D3 charts and a proper state management layer. The only server component is a thin Python service that fetches price data from Yahoo Finance, because there is no good Rust or TypeScript library for that.

The result is an optimizer that feels like a desktop application. Frontier rendering is sub-15ms. Monte Carlo with 500 paths finishes in under 5ms. Walk-forward backtests over 5 years of daily data complete in about 100ms.

---

## Algorithms

Six optimization approaches, each solving a different version of the allocation problem.

| Algorithm | What it solves | When to use it |
|-----------|---------------|----------------|
| Markowitz MVO | Traces the full efficient frontier via mean-variance optimization with Ledoit-Wolf covariance shrinkage | Starting point for any analysis |
| HRP | Hierarchical Risk Parity. Uses clustering on the correlation matrix instead of inverting the covariance, so it does not blow up when your estimates are noisy | When you have many assets or short history |
| Risk Parity (ERC) | Equal Risk Contribution. Each asset contributes the same amount to total portfolio variance | Defensive allocation across mixed asset classes |
| CVaR Minimization | Minimizes expected loss in the worst 5% of scenarios using the Rockafellar-Uryasev formulation | When tail risk matters more than average risk |
| Robust MVO | Ellipsoidal uncertainty sets on expected returns. Finds portfolios that hold up even when your return estimates are wrong | Conservative, real-world oriented |
| Black-Litterman | Blends market equilibrium returns with your subjective views. You say "I think AAPL returns 15% with 70% confidence" and the model adjusts accordingly | When you have conviction but want the math to keep you honest |

---

## What it does

**Optimization workspace.** Interactive efficient frontier chart. Drag along the curve and watch portfolio weights update at 60fps. Overlay multiple algorithms on the same chart to compare their solutions. Weight heatmap shows how allocation shifts across the risk-return spectrum.

**Backtesting engine.** Static buy-and-hold or walk-forward with rolling reoptimization. Configurable transaction costs and slippage. Automatic benchmarks against equal-weight, SPY, 60/40, and All Weather portfolios. In-sample / out-of-sample split. Bootstrap Sharpe ratio confidence intervals. Sankey diagrams showing rebalancing flows between assets. Stress period analysis across the GFC, COVID, and 2022 rate shock.

**Risk analysis.** Historical VaR and CVaR at configurable confidence levels. Monte Carlo simulation with GBM and fan charts. Correlation heatmap with optional 3D globe visualization. Rolling Sharpe and Sortino. Marginal risk contribution per asset. Hidden Markov Model regime detection that identifies bull/bear/neutral market states and shows how your portfolio behaves differently in each. Factor risk decomposition breaking total risk into market, sector, and idiosyncratic components.

**AI research.** Ask natural language questions about your portfolio. Claude has your actual weights, metrics, regime state, and stress test results in context. "What is driving my portfolio's risk?" gets a specific, quantitative answer referencing your actual numbers.

**Persistence.** Sign in with GitHub. Save portfolios, reload them later, compare across sessions.

---

## Stack

```
Rust (nalgebra, wasm-bindgen)  ->  WebAssembly (runs in browser)
Next.js 14, TypeScript         ->  App shell, routing, API
D3.js                          ->  Charts and data visualization
React Three Fiber              ->  3D correlation globe
tRPC + Zustand                 ->  Type-safe API + client state
FastAPI + yfinance             ->  Price data service (Python, only server component)
Anthropic Claude API           ->  AI portfolio analysis
NextAuth + Vercel KV           ->  Auth and persistence
```

Monorepo managed by Turborepo. Radix UI primitives for accessible components. Framer Motion for transitions. Tailwind for styling.

---

## Run locally

Prerequisites: Node.js 18+, pnpm, Rust toolchain, wasm-pack, Python 3.11+

```bash
git clone https://github.com/AdityaChauhanX07/port-opt.git
cd port-opt
pnpm install
```

Build the Rust engine to WASM:

```bash
./scripts/build-wasm.sh
```

Start the Python data service (fetches market data):

```bash
cd apps/data-service
pip install -r requirements.txt
uvicorn main:app --reload --port 8888
```

Start the Next.js app (separate terminal):

```bash
cd apps/web
pnpm dev
```

Open `http://localhost:3000`.

For AI analysis, add your Anthropic API key to `apps/web/.env.local`:

```
ANTHROPIC_API_KEY=sk-ant-...
```

For auth, set up a GitHub OAuth app and add credentials to the same file:

```
GITHUB_ID=...
GITHUB_SECRET=...
NEXTAUTH_SECRET=<any-random-string>
NEXTAUTH_URL=http://localhost:3000
```

---

## Project structure

```
port-opt/
├── apps/
│   ├── web/                    # Next.js frontend
│   │   ├── src/
│   │   │   ├── app/            # Pages (dashboard, optimize, backtest, risk, research)
│   │   │   ├── components/     # UI components
│   │   │   ├── lib/
│   │   │   │   ├── wasm/       # WASM loader, Web Worker, engine bindings
│   │   │   │   ├── stores/     # Zustand state (portfolio, backtest, risk)
│   │   │   │   ├── trpc/       # tRPC client
│   │   │   │   └── hooks/      # Custom hooks (keyboard shortcuts, etc.)
│   │   │   └── server/         # tRPC routers (data, ai, user)
│   │   └── next.config.js
│   │
│   └── data-service/           # Python FastAPI (price fetching only)
│       ├── main.py
│       ├── routers/
│       │   ├── prices.py       # Yahoo Finance proxy
│       │   └── factors.py      # Factor return data
│       └── Dockerfile
│
├── packages/
│   ├── engine/                 # Rust computational core
│   │   └── src/
│   │       ├── optimize/       # MVO, HRP, Risk Parity, CVaR, Robust, Black-Litterman
│   │       ├── backtest/       # Static and walk-forward backtesting
│   │       ├── risk/           # VaR, CVaR, rolling metrics, regime detection, factor decomp
│   │       ├── monte_carlo/    # GBM simulation, block bootstrap
│   │       ├── stats/          # Returns, covariance, portfolio metrics
│   │       └── linalg/         # Eigen decomposition, Cholesky
│   │
│   ├── engine-wasm/            # WASM bridge (wasm-bindgen exports)
│   ├── ui/                     # Radix-based UI primitives
│   ├── charts/                 # D3 chart components
│   ├── three/                  # R3F 3D visualizations
│   └── types/                  # Shared TypeScript types
│
├── scripts/
│   ├── build-wasm.sh           # Rust -> WASM build
│   └── dev.sh                  # Start all services
│
├── turbo.json
└── render.yaml                 # Render deployment config
```

---

## Tests

Rust engine (103 tests covering all optimization algorithms, backtest logic, and statistical functions):

```bash
cd packages/engine
cargo test --release
```

WASM boundary verification:

```bash
node scripts/verify-wasm.mjs
```

TypeScript type checking:

```bash
pnpm typecheck
```

---

## Deploy

Frontend deploys to Vercel. The Python data service deploys to Render.

Vercel picks up the Next.js app from `apps/web/`. Set the environment variables listed above in the Vercel dashboard.

Render uses the `render.yaml` blueprint at the repo root. Point it at the `apps/data-service/Dockerfile`. Set `FRONTEND_URL` to your Vercel domain for CORS.

The WASM bundle is built at build time and ships as part of the Next.js static assets. No runtime compilation needed.

---

Not financial advice. This is a research and learning tool.

MIT License (c) Aditya Chauhan