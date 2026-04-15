# PortOpt v2

A quantitative portfolio optimization tool built on a Turborepo monorepo. Combines a Next.js 14+ frontend, a Python FastAPI data service for price and factor data, and a high-performance Rust computation engine compiled to both native and WebAssembly targets.

## Structure

```
apps/
  web/           Next.js 14+ (App Router, TypeScript strict, Tailwind CSS)
  data-service/  Python FastAPI — price fetching, factor data

packages/
  engine/        Rust library — optimization, backtest, risk, Monte Carlo
  engine-wasm/   Rust → WASM bindings via wasm-bindgen
  ui/            Shared React component library
  charts/        Chart components (D3-based)
  three/         Three.js / 3-D visualizations
  types/         Shared TypeScript type definitions
```

## Getting Started

```bash
pnpm install
pnpm dev
```

For the Rust crates:

```bash
cargo check
```
