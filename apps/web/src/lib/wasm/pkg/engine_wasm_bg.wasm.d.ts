/* tslint:disable */
/* eslint-disable */
export const memory: WebAssembly.Memory;
export const bootstrap_sharpe: (a: number, b: number, c: number, d: number, e: number, f: number, g: bigint) => [number, number];
export const compute_correlation: (a: number, b: number, c: number, d: number) => [number, number];
export const compute_risk_metrics: (a: number, b: number, c: number, d: number) => [number, number];
export const compute_rolling_metrics: (a: number, b: number, c: number, d: number) => [number, number];
export const decompose_factor_risk: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number) => [number, number];
export const detect_regimes_wasm: (a: number, b: number, c: number, d: number, e: bigint) => [number, number];
export const init: () => void;
export const run_backtest_static: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => [number, number];
export const run_backtest_walkforward: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number];
export const run_monte_carlo: (a: number, b: number) => [number, number];
export const solve_black_litterman: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number, n: number) => [number, number];
export const solve_cvar: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => [number, number];
export const solve_frontier: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number) => [number, number];
export const solve_hrp: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number];
export const solve_risk_parity: (a: number, b: number, c: number, d: number, e: number) => [number, number];
export const solve_robust: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number) => [number, number];
export const __wbindgen_free: (a: number, b: number, c: number) => void;
export const __wbindgen_malloc: (a: number, b: number) => number;
export const __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
export const __wbindgen_externrefs: WebAssembly.Table;
export const __wbindgen_start: () => void;
