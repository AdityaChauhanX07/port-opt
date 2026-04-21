/* tslint:disable */
/* eslint-disable */

/**
 * Block-bootstrap Sharpe ratio confidence interval.
 *
 * Returns JSON: `{"mean":...,"ci_lower":...,"ci_upper":...,"n_samples":...}`
 */
export function bootstrap_sharpe(returns_flat: Float64Array, rf_per_period: number, n_boot: number, block_size: number, ci: number, seed: bigint): string;

/**
 * Compute the Pearson correlation matrix from a return matrix.
 *
 * Returns JSON: `{"corr":[...],"shape":[n_assets,n_assets]}`
 * where `corr` is a flat row-major array.
 */
export function compute_correlation(returns_flat: Float64Array, n_rows: number, n_cols: number): string;

/**
 * Compute annualised performance metrics from an equity curve.
 *
 * Returns JSON:
 * `{"cagr":..., "ann_return":..., "ann_vol":..., "max_dd":..., "var_95":..., "cvar_95":...}`
 */
export function compute_risk_metrics(equity_flat: Float64Array, rf: number, ppy: number): string;

/**
 * Compute rolling Sharpe and Sortino ratios from a return series.
 *
 * Returns JSON: `{"rolling_sharpe":[...],"rolling_sortino":[...]}`
 * (`null` for windows that cannot be computed).
 */
export function compute_rolling_metrics(returns_flat: Float64Array, rf_per_period: number, window: number): string;

/**
 * OLS factor risk decomposition.
 *
 * `portfolio_returns`: T-element portfolio return vector.
 * `factor_returns_flat`: T × K factor return matrix, row-major.
 * `n_periods`: T (number of return observations).
 * `n_factors`: K (number of factors).
 * `factor_names_json`: JSON array of factor name strings.
 * `ppy`: periods per year for annualisation.
 *
 * Returns JSON:
 * `{"factor_names":[...],"betas":[...],"factor_risk_contributions":[...],`
 * `"specific_risk_pct":...,"r_squared":...,"alpha":...,"tracking_error":...`,
 * `"information_ratio":...,"t_stats":[...]}`
 */
export function decompose_factor_risk(portfolio_returns: Float64Array, factor_returns_flat: Float64Array, n_periods: number, n_factors: number, factor_names_json: string, ppy: number): string;

/**
 * Fit a Gaussian HMM to a return series and decode market regimes.
 *
 * `returns_flat`: T-element return vector.
 * `n_regimes`: number of hidden states (2 or 3 recommended).
 * `max_iter`: maximum Baum-Welch iterations.
 * `seed`: RNG seed for initialisation perturbation.
 *
 * Returns JSON:
 * `{"n_regimes":int,"state_sequence":[...],"state_probabilities":[[...],...]`,
 * `"regime_means":[...],"regime_vols":[...],"transition_matrix":[[...],...]`,
 * `"stationary_dist":[...]}`
 */
export function detect_regimes_wasm(returns_flat: Float64Array, n_regimes: number, max_iter: number, seed: bigint): string;

/**
 * Initialise the WASM module.  Call once from JS before any other function.
 * Sets up `console.error` panic hook so panics surface in the browser console.
 */
export function init(): void;

/**
 * Run a static (buy-and-hold) backtest.
 *
 * `weights_flat`: n-element weight vector.
 *
 * Returns JSON:
 * `{"portfolio_equity":[...],"portfolio_returns":[...],"portfolio_dd":[...],
 *   "ew_equity":[...]|null,"ew_dd":[...]|null}`
 */
export function run_backtest_static(returns_flat: Float64Array, n_rows: number, n_cols: number, weights_flat: Float64Array, include_ew: boolean): string;

/**
 * Run a walk-forward backtest with rolling-window re-optimisation.
 *
 * `config_json`: JSON matching `WalkforwardConfig` fields (all optional, defaults shown):
 * ```json
 * {"window":60,"step":21,"tc_bps":0.0005,"slippage_bps":0.0002,
 *  "long_only":true,"lb":0.0,"ub":1.0,"shrinkage_alpha":0.1,
 *  "n_pts":20,"rf":0.0,"ppy":252}
 * ```
 *
 * Returns JSON with equity curve, drawdown, flattened weight history, rebalance indices.
 */
export function run_backtest_walkforward(returns_flat: Float64Array, n_rows: number, n_cols: number, config_json: string): string;

/**
 * Run a single-portfolio GBM Monte Carlo simulation.
 *
 * `params_json`: JSON object:
 * ```json
 * {"mu_annual":0.08,"vol_annual":0.20,"start_value":1.0,
 *  "years":1.0,"ppy":252,"n_paths":1000,"seed":42}
 * ```
 *
 * Returns JSON with terminal distribution summary statistics.
 */
export function run_monte_carlo(params_json: string): string;

/**
 * Black-Litterman model: blend equilibrium returns with investor views.
 *
 * `cov_flat`: N×N annualised covariance matrix, row-major.
 * `market_weights_flat`: N-vector of market-cap or equal weights.
 * `views_packed`: encoded view array:
 *   `[n_views, per view: n_picks, idx_0, w_0, …, expected_return, confidence, …]`
 * `n_pts`: number of frontier portfolios to trace.
 *
 * Returns JSON:
 * `{"weights":[…],"risks":[…],"returns":[…],"sharpes":[…],"best_idx":int|null,
 *   "n_portfolios":int,"n_assets":int,"implied_returns":[…],"posterior_mu":[…]}`
 */
export function solve_black_litterman(cov_flat: Float64Array, n_assets: number, market_weights_flat: Float64Array, rf: number, market_return: number, views_packed: Float64Array, tau: number, long_only: boolean, lb: number, ub: number, n_pts: number): string;

/**
 * Minimise CVaR at confidence `alpha`.
 *
 * Native: uses Clarabel LP solver.
 * WASM:   uses projected subgradient descent (no Clarabel dependency).
 *
 * Returns JSON: `{"weights":[...]}` or `{"error":"..."}`.
 */
export function solve_cvar(returns_flat: Float64Array, n_rows: number, n_cols: number, alpha: number, long_only: boolean, lb: number, ub: number): string;

/**
 * Trace the efficient frontier and return portfolios with their statistics.
 *
 * `returns_flat`: T×n return matrix, row-major.
 *
 * Returns JSON:
 * `{"weights":[...],"risks":[...],"returns":[...],"sharpes":[...],"best_idx":int|null}`
 *
 * `weights` is a flat row-major array of shape `(n_feasible × n_assets)`.
 */
export function solve_frontier(returns_flat: Float64Array, n_rows: number, n_cols: number, n_pts: number, long_only: boolean, lb: number, ub: number, rf: number, ppy: number): string;

/**
 * Compute HRP weights from a return matrix.
 *
 * `tickers_json`: JSON array of strings, e.g. `["SPY","BND","GLD"]`.
 *
 * Returns JSON: `{"weights":[...],"tickers":[...]}`.
 */
export function solve_hrp(returns_flat: Float64Array, n_rows: number, n_cols: number, tickers_json: string): string;

/**
 * Compute Equal Risk Contribution (risk-parity) weights.
 *
 * `cov_flat`: n×n covariance matrix, row-major.
 *
 * Returns JSON: `{"weights":[...]}`.
 */
export function solve_risk_parity(cov_flat: Float64Array, n: number, lb: number, ub: number): string;

/**
 * Robust mean–variance optimisation with ellipsoidal return uncertainty.
 *
 * Native: uses Clarabel SOCP solver.
 * WASM:   uses projected gradient descent (no Clarabel dependency).
 *
 * Returns JSON: `{"weights":[...]}` or `{"error":"..."}`.
 */
export function solve_robust(returns_flat: Float64Array, n_rows: number, n_cols: number, gamma: number, long_only: boolean, lb: number, ub: number, ppy: number): string;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly bootstrap_sharpe: (a: number, b: number, c: number, d: number, e: number, f: number, g: bigint) => [number, number];
    readonly compute_correlation: (a: number, b: number, c: number, d: number) => [number, number];
    readonly compute_risk_metrics: (a: number, b: number, c: number, d: number) => [number, number];
    readonly compute_rolling_metrics: (a: number, b: number, c: number, d: number) => [number, number];
    readonly decompose_factor_risk: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number) => [number, number];
    readonly detect_regimes_wasm: (a: number, b: number, c: number, d: number, e: bigint) => [number, number];
    readonly init: () => void;
    readonly run_backtest_static: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => [number, number];
    readonly run_backtest_walkforward: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number];
    readonly run_monte_carlo: (a: number, b: number) => [number, number];
    readonly solve_black_litterman: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number, n: number) => [number, number];
    readonly solve_cvar: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => [number, number];
    readonly solve_frontier: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number) => [number, number];
    readonly solve_hrp: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number];
    readonly solve_risk_parity: (a: number, b: number, c: number, d: number, e: number) => [number, number];
    readonly solve_robust: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number) => [number, number];
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
