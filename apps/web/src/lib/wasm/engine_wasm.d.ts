/**
 * Stub type declarations for the wasm-pack output.
 *
 * The real module lives at packages/engine-wasm/pkg/ and is copied here by
 * build-wasm.sh.  Until that script is run this file keeps TypeScript happy
 * by declaring the module shape without requiring the files to exist.
 *
 * All exported functions match the #[wasm_bindgen] definitions in
 * packages/engine-wasm/src/lib.rs.  They all accept Vec<f64> as
 * Float64Array and return JSON strings.
 */
declare module '*/pkg/engine_wasm' {
  /** Initialise the WASM module.  Must be awaited before any other call. */
  export default function init(
    module_or_path?: string | URL | Request | BufferSource | WebAssembly.Module,
  ): Promise<void>;

  export function solve_frontier(
    returns_flat: Float64Array,
    n_rows: number,
    n_cols: number,
    n_pts: number,
    long_only: boolean,
    lb: number,
    ub: number,
    rf: number,
    ppy: number,
  ): string;

  export function solve_hrp(
    returns_flat: Float64Array,
    n_rows: number,
    n_cols: number,
    tickers_json: string,
  ): string;

  export function solve_risk_parity(
    cov_flat: Float64Array,
    n: number,
    lb: number,
    ub: number,
  ): string;

  export function solve_cvar(
    returns_flat: Float64Array,
    n_rows: number,
    n_cols: number,
    alpha: number,
    long_only: boolean,
    lb: number,
    ub: number,
  ): string;

  export function solve_robust(
    returns_flat: Float64Array,
    n_rows: number,
    n_cols: number,
    gamma: number,
    long_only: boolean,
    lb: number,
    ub: number,
    ppy: number,
  ): string;

  export function run_monte_carlo(params_json: string): string;

  export function run_backtest_static(
    returns_flat: Float64Array,
    n_rows: number,
    n_cols: number,
    weights_flat: Float64Array,
    include_ew: boolean,
  ): string;

  export function run_backtest_walkforward(
    returns_flat: Float64Array,
    n_rows: number,
    n_cols: number,
    config_json: string,
  ): string;

  export function compute_risk_metrics(
    equity_flat: Float64Array,
    rf: number,
    ppy: number,
  ): string;

  export function compute_rolling_metrics(
    returns_flat: Float64Array,
    rf_per_period: number,
    window: number,
  ): string;

  export function compute_correlation(
    returns_flat: Float64Array,
    n_rows: number,
    n_cols: number,
  ): string;

  export function bootstrap_sharpe(
    returns_flat: Float64Array,
    rf_per_period: number,
    n_boot: number,
    block_size: number,
    ci: number,
    seed: bigint,
  ): string;

  export function solve_black_litterman(
    cov_flat: Float64Array,
    n_assets: number,
    market_weights_flat: Float64Array,
    rf: number,
    market_return: number,
    views_packed: Float64Array,
    tau: number,
    long_only: boolean,
    lb: number,
    ub: number,
    n_pts: number,
  ): string;
}
