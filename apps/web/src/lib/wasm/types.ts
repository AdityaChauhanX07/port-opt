// ---------------------------------------------------------------------------
// Shared TypeScript types for the WASM engine interface.
// These mirror the JSON shapes returned by the Rust WASM bridge.
// ---------------------------------------------------------------------------

export interface FrontierResult {
  /** Flat row-major weight matrix (nPoints × nAssets). */
  weights: Float64Array;
  risks: Float64Array;
  returns: Float64Array;
  sharpes: Float64Array;
  bestIdx: number | null;
  nPoints: number;
  nAssets: number;
}

export interface MonteCarloResult {
  mean: number | null;
  median: number | null;
  p5: number | null;
  p25: number | null;
  p75: number | null;
  p95: number | null;
  std: number | null;
  probLoss: number | null;
}

export interface BacktestResult {
  portfolioEquity: Float64Array;
  portfolioReturns: Float64Array;
  portfolioDD: Float64Array;
  ewEquity: Float64Array | null;
  ewDD: Float64Array | null;
}

export interface WalkforwardResult {
  portfolioEquity: Float64Array;
  portfolioReturns: Float64Array;
  portfolioDD: Float64Array;
  /** Flat row-major weight history (nRebalances × nAssets). */
  weightsHistory: Float64Array;
  weightsShape: [number, number];
  rebalanceIndices: number[];
  ewEquity: Float64Array | null;
}

export interface RiskMetrics {
  cagr: number | null;
  annReturn: number | null;
  annVol: number | null;
  maxDd: number | null;
  var95: number | null;
  cvar95: number | null;
}

export interface BootstrapResult {
  mean: number | null;
  ciLower: number | null;
  ciUpper: number | null;
  nSamples: number;
}

export interface WalkforwardConfig {
  window?: number;
  step?: number;
  tc_bps?: number;
  slippage_bps?: number;
  long_only?: boolean;
  lb?: number;
  ub?: number;
  shrinkage_alpha?: number;
  n_pts?: number;
  rf?: number;
  ppy?: number;
}

export interface MonteCarloParams {
  mu_annual: number;
  vol_annual: number;
  start_value: number;
  years: number;
  ppy: number;
  n_paths: number;
  seed: number;
}

export interface SolveFrontierParams {
  returns: Float64Array;   // row-major (nPeriods × nAssets)
  nPeriods: number;
  nAssets: number;
  nPts: number;
  longOnly: boolean;
  lb: number;
  ub: number;
  rf: number;
  ppy: number;
}

// ---------------------------------------------------------------------------
// Worker message protocol
// ---------------------------------------------------------------------------

export type EngineMethod =
  | 'solveFrontier'
  | 'solveHrp'
  | 'solveRiskParity'
  | 'solveCvar'
  | 'solveRobust'
  | 'runMonteCarlo'
  | 'runBacktestStatic'
  | 'runBacktestWalkforward'
  | 'computeRiskMetrics'
  | 'computeCorrelation'
  | 'bootstrapSharpe';

export interface WorkerRequest {
  id: number;
  method: EngineMethod;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  payload: any;
}

export interface WorkerResponse {
  id: number;
  result?: unknown;
  error?: string;
}
