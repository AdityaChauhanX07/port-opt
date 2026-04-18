//! WASM bridge — exposes the `engine` crate to JavaScript via wasm-bindgen.
//!
//! # Data interchange
//! All matrix data is passed as flat `Vec<f64>` in row-major order plus explicit
//! dimension parameters.  Complex input configs and all outputs use JSON strings
//! so the JS/TS caller can decode them with `JSON.parse`.
//!
//! # Error convention
//! On any error the returned JSON string is `{"error":"<message>"}`.

use wasm_bindgen::prelude::*;

use engine::{
    backtest::{static_run, walkforward_run, WalkforwardConfig},
    monte_carlo::{
        bootstrap::sharpe_ci,
        gbm::{simulate, summarize_terminal, GbmParams},
    },
    optimize::{self, hrp, risk_parity, black_litterman},
    risk::{decompose_factors, detect_regimes, historical_var_cvar, rolling_sharpe, rolling_sortino},
    stats::{annualize, correlation, max_drawdown, ann_return_vol, cagr},
};
use nalgebra::{DMatrix, DVector};

// ---------------------------------------------------------------------------
// One-time WASM initialisation
// ---------------------------------------------------------------------------

/// Initialise the WASM module.  Call once from JS before any other function.
/// Sets up `console.error` panic hook so panics surface in the browser console.
#[wasm_bindgen(start)]
pub fn init() {
    console_error_panic_hook::set_once();
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/// Reconstruct a row-major `DMatrix<f64>` from a flat slice.
fn flat_to_matrix(
    data: &[f64],
    n_rows: usize,
    n_cols: usize,
) -> Result<nalgebra::DMatrix<f64>, String> {
    if data.len() != n_rows * n_cols {
        return Err(format!(
            "flat data length {} != {} rows × {} cols",
            data.len(),
            n_rows,
            n_cols
        ));
    }
    Ok(nalgebra::DMatrix::from_fn(n_rows, n_cols, |r, c| data[r * n_cols + c]))
}

/// Encode a `&[f64]` as a JSON array string.  `NaN`/`Inf` → `null`.
fn vec_to_json(v: &[f64]) -> String {
    let joined: Vec<String> = v
        .iter()
        .map(|x| if x.is_finite() { format!("{x}") } else { "null".to_string() })
        .collect();
    format!("[{}]", joined.join(","))
}

/// Encode an error as `{"error":"..."}`.
fn err_json(msg: &str) -> String {
    let escaped = msg.replace('\\', "\\\\").replace('"', "\\\"");
    format!("{{\"error\":\"{escaped}\"}}")
}

// ---------------------------------------------------------------------------
// Frontier / optimisation
// ---------------------------------------------------------------------------

/// Trace the efficient frontier and return portfolios with their statistics.
///
/// `returns_flat`: T×n return matrix, row-major.
///
/// Returns JSON:
/// `{"weights":[...],"risks":[...],"returns":[...],"sharpes":[...],"best_idx":int|null}`
///
/// `weights` is a flat row-major array of shape `(n_feasible × n_assets)`.
#[wasm_bindgen]
pub fn solve_frontier(
    returns_flat: Vec<f64>,
    n_rows: usize,
    n_cols: usize,
    n_pts: usize,
    long_only: bool,
    lb: f64,
    ub: f64,
    rf: f64,
    ppy: usize,
) -> String {
    let ret_mat = match flat_to_matrix(&returns_flat, n_rows, n_cols) {
        Ok(m) => m,
        Err(e) => return err_json(&e),
    };
    let (mu, cov) = match annualize(&ret_mat, ppy) {
        Ok(v) => v,
        Err(e) => return err_json(&e),
    };
    match optimize::trace(&mu, &cov, n_pts, long_only, lb, ub, rf) {
        Err(e) => err_json(&e.to_string()),
        Ok(fr) => {
            let k = fr.weights.nrows();
            let n = fr.weights.ncols();
            let mut w_flat = Vec::with_capacity(k * n);
            for r in 0..k {
                for c in 0..n {
                    w_flat.push(fr.weights[(r, c)]);
                }
            }
            let best_idx = fr
                .best_idx
                .map(|i| i.to_string())
                .unwrap_or_else(|| "null".to_string());
            format!(
                "{{\"weights\":{w},\"risks\":{r},\"returns\":{ret},\
                 \"sharpes\":{s},\"best_idx\":{bi},\"n_portfolios\":{k},\"n_assets\":{n}}}",
                w   = vec_to_json(&w_flat),
                r   = vec_to_json(fr.risks.as_slice()),
                ret = vec_to_json(fr.returns.as_slice()),
                s   = vec_to_json(fr.sharpes.as_slice()),
                bi  = best_idx,
            )
        }
    }
}

/// Compute HRP weights from a return matrix.
///
/// `tickers_json`: JSON array of strings, e.g. `["SPY","BND","GLD"]`.
///
/// Returns JSON: `{"weights":[...],"tickers":[...]}`.
#[wasm_bindgen]
pub fn solve_hrp(
    returns_flat: Vec<f64>,
    n_rows: usize,
    n_cols: usize,
    tickers_json: &str,
) -> String {
    let ret_mat = match flat_to_matrix(&returns_flat, n_rows, n_cols) {
        Ok(m) => m,
        Err(e) => return err_json(&e),
    };
    let tickers: Vec<String> = match serde_json::from_str(tickers_json) {
        Ok(v) => v,
        Err(e) => return err_json(&format!("invalid tickers JSON: {e}")),
    };
    if tickers.len() != n_cols {
        return err_json(&format!("tickers length {} != n_cols {n_cols}", tickers.len()));
    }
    match hrp::solve(&ret_mat, &tickers) {
        Err(e) => err_json(&e.to_string()),
        Ok(w) => {
            let ticker_strs: Vec<String> = tickers.iter().map(|t| format!("\"{t}\"")).collect();
            format!(
                "{{\"weights\":{},\"tickers\":[{}]}}",
                vec_to_json(w.as_slice()),
                ticker_strs.join(","),
            )
        }
    }
}

/// Compute Equal Risk Contribution (risk-parity) weights.
///
/// `cov_flat`: n×n covariance matrix, row-major.
///
/// Returns JSON: `{"weights":[...]}`.
#[wasm_bindgen]
pub fn solve_risk_parity(cov_flat: Vec<f64>, n: usize, lb: f64, ub: f64) -> String {
    let cov = match flat_to_matrix(&cov_flat, n, n) {
        Ok(m) => m,
        Err(e) => return err_json(&e),
    };
    match risk_parity::solve(&cov, lb, ub) {
        Err(e) => err_json(&e.to_string()),
        Ok(w) => format!("{{\"weights\":{}}}", vec_to_json(w.as_slice())),
    }
}

/// Minimise CVaR at confidence `alpha`.
///
/// Native: uses Clarabel LP solver.
/// WASM:   uses projected subgradient descent (no Clarabel dependency).
///
/// Returns JSON: `{"weights":[...]}` or `{"error":"..."}`.
#[wasm_bindgen]
pub fn solve_cvar(
    returns_flat: Vec<f64>,
    n_rows: usize,
    n_cols: usize,
    alpha: f64,
    long_only: bool,
    lb: f64,
    ub: f64,
) -> String {
    let ret_mat = match flat_to_matrix(&returns_flat, n_rows, n_cols) {
        Ok(m) => m,
        Err(e) => return err_json(&e),
    };
    match engine::optimize::cvar::solve(&ret_mat, alpha, long_only, lb, ub) {
        Err(e) => err_json(&e.to_string()),
        Ok(w) => format!("{{\"weights\":{}}}", vec_to_json(w.as_slice())),
    }
}

/// Robust mean–variance optimisation with ellipsoidal return uncertainty.
///
/// Native: uses Clarabel SOCP solver.
/// WASM:   uses projected gradient descent (no Clarabel dependency).
///
/// Returns JSON: `{"weights":[...]}` or `{"error":"..."}`.
#[wasm_bindgen]
pub fn solve_robust(
    returns_flat: Vec<f64>,
    n_rows: usize,
    n_cols: usize,
    gamma: f64,
    long_only: bool,
    lb: f64,
    ub: f64,
    ppy: usize,
) -> String {
    let ret_mat = match flat_to_matrix(&returns_flat, n_rows, n_cols) {
        Ok(m) => m,
        Err(e) => return err_json(&e),
    };
    let (mu, cov) = match annualize(&ret_mat, ppy) {
        Ok(v) => v,
        Err(e) => return err_json(&e),
    };
    match engine::optimize::robust::solve(&mu, &cov, gamma, long_only, lb, ub) {
        Err(e) => err_json(&e.to_string()),
        Ok(w) => format!("{{\"weights\":{}}}", vec_to_json(w.as_slice())),
    }
}

// ---------------------------------------------------------------------------
// Monte Carlo
// ---------------------------------------------------------------------------

/// Run a single-portfolio GBM Monte Carlo simulation.
///
/// `params_json`: JSON object:
/// ```json
/// {"mu_annual":0.08,"vol_annual":0.20,"start_value":1.0,
///  "years":1.0,"ppy":252,"n_paths":1000,"seed":42}
/// ```
///
/// Returns JSON with terminal distribution summary statistics.
#[wasm_bindgen]
pub fn run_monte_carlo(params_json: &str) -> String {
    let v: serde_json::Value = match serde_json::from_str(params_json) {
        Ok(v) => v,
        Err(e) => return err_json(&format!("invalid params JSON: {e}")),
    };

    macro_rules! get_f64 {
        ($key:expr) => {
            match v[$key].as_f64() {
                Some(x) => x,
                None => return err_json(&format!("missing or non-numeric field '{}'", $key)),
            }
        };
    }
    macro_rules! get_u64 {
        ($key:expr) => {
            match v[$key].as_u64() {
                Some(x) => x,
                None => return err_json(&format!("missing or non-integer field '{}'", $key)),
            }
        };
    }

    let params = GbmParams {
        mu_annual:   get_f64!("mu_annual"),
        vol_annual:  get_f64!("vol_annual"),
        start_value: get_f64!("start_value"),
        years:       get_f64!("years"),
        ppy:         get_u64!("ppy") as usize,
        n_paths:     get_u64!("n_paths") as usize,
        seed:        get_u64!("seed"),
    };

    let paths = simulate(&params);
    let s = summarize_terminal(&paths, params.start_value);

    let fmt = |v: f64| -> String {
        if v.is_finite() { format!("{v}") } else { "null".to_string() }
    };

    format!(
        "{{\"mean\":{mean},\"median\":{median},\"p5\":{p5},\"p25\":{p25},\
         \"p75\":{p75},\"p95\":{p95},\"std\":{std},\"prob_loss\":{pl}}}",
        mean   = fmt(s.mean),
        median = fmt(s.median),
        p5     = fmt(s.p5),
        p25    = fmt(s.p25),
        p75    = fmt(s.p75),
        p95    = fmt(s.p95),
        std    = fmt(s.std),
        pl     = fmt(s.prob_loss),
    )
}

// ---------------------------------------------------------------------------
// Backtests
// ---------------------------------------------------------------------------

/// Run a static (buy-and-hold) backtest.
///
/// `weights_flat`: n-element weight vector.
///
/// Returns JSON:
/// `{"portfolio_equity":[...],"portfolio_returns":[...],"portfolio_dd":[...],
///   "ew_equity":[...]|null,"ew_dd":[...]|null}`
#[wasm_bindgen]
pub fn run_backtest_static(
    returns_flat: Vec<f64>,
    n_rows: usize,
    n_cols: usize,
    weights_flat: Vec<f64>,
    include_ew: bool,
) -> String {
    let ret_mat = match flat_to_matrix(&returns_flat, n_rows, n_cols) {
        Ok(m) => m,
        Err(e) => return err_json(&e),
    };
    if weights_flat.len() != n_cols {
        return err_json(&format!(
            "weights length {} != n_cols {n_cols}",
            weights_flat.len()
        ));
    }
    let w = DVector::from_vec(weights_flat);
    match static_run(&ret_mat, &w, include_ew) {
        Err(e) => err_json(&e.to_string()),
        Ok(r) => {
            let ew_eq = r
                .ew_equity
                .as_ref()
                .map(|v| vec_to_json(v.as_slice()))
                .unwrap_or_else(|| "null".to_string());
            let ew_dd = r
                .ew_dd
                .as_ref()
                .map(|v| vec_to_json(v.as_slice()))
                .unwrap_or_else(|| "null".to_string());
            format!(
                "{{\"portfolio_equity\":{eq},\"portfolio_returns\":{rets},\
                 \"portfolio_dd\":{dd},\"ew_equity\":{ew_eq},\"ew_dd\":{ew_dd}}}",
                eq    = vec_to_json(r.portfolio_equity.as_slice()),
                rets  = vec_to_json(r.portfolio_returns.as_slice()),
                dd    = vec_to_json(r.portfolio_dd.as_slice()),
            )
        }
    }
}

/// Run a walk-forward backtest with rolling-window re-optimisation.
///
/// `config_json`: JSON matching `WalkforwardConfig` fields (all optional, defaults shown):
/// ```json
/// {"window":60,"step":21,"tc_bps":0.0005,"slippage_bps":0.0002,
///  "long_only":true,"lb":0.0,"ub":1.0,"shrinkage_alpha":0.1,
///  "n_pts":20,"rf":0.0,"ppy":252}
/// ```
///
/// Returns JSON with equity curve, drawdown, flattened weight history, rebalance indices.
#[wasm_bindgen]
pub fn run_backtest_walkforward(
    returns_flat: Vec<f64>,
    n_rows: usize,
    n_cols: usize,
    config_json: &str,
) -> String {
    let ret_mat = match flat_to_matrix(&returns_flat, n_rows, n_cols) {
        Ok(m) => m,
        Err(e) => return err_json(&e),
    };
    let v: serde_json::Value = match serde_json::from_str(config_json) {
        Ok(v) => v,
        Err(e) => return err_json(&format!("invalid config JSON: {e}")),
    };
    let config = WalkforwardConfig {
        window:          v["window"].as_u64().unwrap_or(60) as usize,
        step:            v["step"].as_u64().unwrap_or(21) as usize,
        tc_bps:          v["tc_bps"].as_f64().unwrap_or(0.0),
        slippage_bps:    v["slippage_bps"].as_f64().unwrap_or(0.0),
        long_only:       v["long_only"].as_bool().unwrap_or(true),
        lb:              v["lb"].as_f64().unwrap_or(0.0),
        ub:              v["ub"].as_f64().unwrap_or(1.0),
        shrinkage_alpha: v["shrinkage_alpha"].as_f64().unwrap_or(0.1),
        n_pts:           v["n_pts"].as_u64().unwrap_or(20) as usize,
        rf:              v["rf"].as_f64().unwrap_or(0.0),
        ppy:             v["ppy"].as_u64().unwrap_or(252) as usize,
    };

    match walkforward_run(&ret_mat, &config) {
        Err(e) => err_json(&e.to_string()),
        Ok(r) => {
            let n_reb = r.weights_history.nrows();
            let n_a   = r.weights_history.ncols();
            let mut wh_flat = Vec::with_capacity(n_reb * n_a);
            for row in 0..n_reb {
                for col in 0..n_a {
                    wh_flat.push(r.weights_history[(row, col)]);
                }
            }
            let reb_indices: Vec<String> =
                r.rebalance_indices.iter().map(|i| i.to_string()).collect();
            let ew_eq = r
                .ew_equity
                .as_ref()
                .map(|v| vec_to_json(v.as_slice()))
                .unwrap_or_else(|| "null".to_string());
            format!(
                "{{\"portfolio_equity\":{eq},\"portfolio_returns\":{rets},\
                 \"portfolio_dd\":{dd},\"weights_history\":{wh},\
                 \"weights_shape\":[{n_reb},{n_a}],\
                 \"rebalance_indices\":[{reb}],\"ew_equity\":{ew_eq}}}",
                eq    = vec_to_json(r.portfolio_equity.as_slice()),
                rets  = vec_to_json(r.portfolio_returns.as_slice()),
                dd    = vec_to_json(r.portfolio_dd.as_slice()),
                wh    = vec_to_json(&wh_flat),
                reb   = reb_indices.join(","),
                ew_eq = ew_eq,
            )
        }
    }
}

// ---------------------------------------------------------------------------
// Risk metrics
// ---------------------------------------------------------------------------

/// Compute annualised performance metrics from an equity curve.
///
/// Returns JSON:
/// `{"cagr":..., "ann_return":..., "ann_vol":..., "max_dd":..., "var_95":..., "cvar_95":...}`
#[wasm_bindgen]
pub fn compute_risk_metrics(equity_flat: Vec<f64>, rf: f64, ppy: usize) -> String {
    if equity_flat.is_empty() {
        return err_json("equity curve is empty");
    }
    let equity = DVector::from_vec(equity_flat);
    let n = equity.len();

    let rets: Vec<f64> = (0..n.saturating_sub(1))
        .map(|i| equity[i + 1] / equity[i] - 1.0)
        .collect();

    let cagr_val      = cagr(&equity, ppy);
    let (ann_ret, ann_vol) = ann_return_vol(&equity, ppy);
    let mdd           = max_drawdown(&equity);

    let (var95, cvar95) = if rets.is_empty() {
        (f64::NAN, f64::NAN)
    } else {
        let rv = DVector::from_vec(rets);
        historical_var_cvar(&rv, 0.95).unwrap_or((f64::NAN, f64::NAN))
    };

    // Suppress rf from portfolio_metrics — we already have the full equity curve
    let _ = rf; // rf accepted for API symmetry but not used here

    let fmt = |v: f64| -> String {
        if v.is_finite() { format!("{v}") } else { "null".to_string() }
    };

    format!(
        "{{\"cagr\":{cagr},\"ann_return\":{ar},\"ann_vol\":{av},\
         \"max_dd\":{mdd},\"var_95\":{var},\"cvar_95\":{cvar}}}",
        cagr = fmt(cagr_val),
        ar   = fmt(ann_ret),
        av   = fmt(ann_vol),
        mdd  = fmt(mdd),
        var  = fmt(var95),
        cvar = fmt(cvar95),
    )
}

/// Compute rolling Sharpe and Sortino ratios from a return series.
///
/// Returns JSON: `{"rolling_sharpe":[...],"rolling_sortino":[...]}`
/// (`null` for windows that cannot be computed).
#[wasm_bindgen]
pub fn compute_rolling_metrics(
    returns_flat: Vec<f64>,
    rf_per_period: f64,
    window: usize,
) -> String {
    let rets = DVector::from_vec(returns_flat);
    let sharpe  = rolling_sharpe(&rets, rf_per_period, window);
    let sortino = rolling_sortino(&rets, rf_per_period, window);
    format!(
        "{{\"rolling_sharpe\":{s},\"rolling_sortino\":{so}}}",
        s  = vec_to_json(sharpe.as_slice()),
        so = vec_to_json(sortino.as_slice()),
    )
}

/// Compute the Pearson correlation matrix from a return matrix.
///
/// Returns JSON: `{"corr":[...],"shape":[n_assets,n_assets]}`
/// where `corr` is a flat row-major array.
#[wasm_bindgen]
pub fn compute_correlation(
    returns_flat: Vec<f64>,
    n_rows: usize,
    n_cols: usize,
) -> String {
    let ret_mat = match flat_to_matrix(&returns_flat, n_rows, n_cols) {
        Ok(m) => m,
        Err(e) => return err_json(&e),
    };
    match correlation(&ret_mat) {
        Err(e) => err_json(&e),
        Ok(corr) => {
            let n = corr.nrows();
            let mut flat = Vec::with_capacity(n * n);
            for r in 0..n {
                for c in 0..n {
                    flat.push(corr[(r, c)]);
                }
            }
            format!(
                "{{\"corr\":{corr},\"shape\":[{n},{n}]}}",
                corr = vec_to_json(&flat),
            )
        }
    }
}

// ---------------------------------------------------------------------------
// Bootstrap Sharpe CI
// ---------------------------------------------------------------------------

/// Block-bootstrap Sharpe ratio confidence interval.
///
/// Returns JSON: `{"mean":...,"ci_lower":...,"ci_upper":...,"n_samples":...}`
#[wasm_bindgen]
pub fn bootstrap_sharpe(
    returns_flat: Vec<f64>,
    rf_per_period: f64,
    n_boot: usize,
    block_size: usize,
    ci: f64,
    seed: u64,
) -> String {
    let rets = DVector::from_vec(returns_flat);
    let result = sharpe_ci(&rets, rf_per_period, n_boot, block_size, ci, seed);
    let fmt = |v: f64| -> String {
        if v.is_finite() { format!("{v}") } else { "null".to_string() }
    };
    format!(
        "{{\"mean\":{mean},\"ci_lower\":{lo},\"ci_upper\":{hi},\"n_samples\":{n}}}",
        mean = fmt(result.mean),
        lo   = fmt(result.ci_lower),
        hi   = fmt(result.ci_upper),
        n    = result.samples.len(),
    )
}

// ---------------------------------------------------------------------------
// Black-Litterman
// ---------------------------------------------------------------------------

/// Black-Litterman model: blend equilibrium returns with investor views.
///
/// `cov_flat`: N×N annualised covariance matrix, row-major.
/// `market_weights_flat`: N-vector of market-cap or equal weights.
/// `views_packed`: encoded view array:
///   `[n_views, per view: n_picks, idx_0, w_0, …, expected_return, confidence, …]`
/// `n_pts`: number of frontier portfolios to trace.
///
/// Returns JSON:
/// `{"weights":[…],"risks":[…],"returns":[…],"sharpes":[…],"best_idx":int|null,
///   "n_portfolios":int,"n_assets":int,"implied_returns":[…],"posterior_mu":[…]}`
#[wasm_bindgen]
pub fn solve_black_litterman(
    cov_flat: Vec<f64>,
    n_assets: usize,
    market_weights_flat: Vec<f64>,
    rf: f64,
    market_return: f64,
    views_packed: Vec<f64>,
    tau: f64,
    long_only: bool,
    lb: f64,
    ub: f64,
    n_pts: usize,
) -> String {
    // Parse covariance matrix.
    let cov = match flat_to_matrix(&cov_flat, n_assets, n_assets) {
        Ok(m) => m,
        Err(e) => return err_json(&e),
    };

    // Parse market weights.
    if market_weights_flat.len() != n_assets {
        return err_json(&format!(
            "market_weights length {} != n_assets {n_assets}",
            market_weights_flat.len()
        ));
    }
    let market_weights = DVector::from_vec(market_weights_flat);

    // Parse views from packed format.
    let views = if views_packed.is_empty() {
        Vec::new()
    } else {
        match black_litterman::parse_views_packed(&views_packed, n_assets) {
            Ok((v, _)) => v,
            Err(e) => return err_json(&e),
        }
    };

    // Run Black-Litterman solver.
    match black_litterman::solve(
        &cov,
        &market_weights,
        rf,
        market_return,
        &views,
        tau,
        long_only,
        lb,
        ub,
        n_pts,
    ) {
        Err(e) => err_json(&e.to_string()),
        Ok(bl) => {
            let fr = &bl.frontier;
            let k  = fr.weights.nrows();
            let n  = fr.weights.ncols();
            let mut w_flat = Vec::with_capacity(k * n);
            for r in 0..k {
                for c in 0..n {
                    w_flat.push(fr.weights[(r, c)]);
                }
            }
            let best_idx = fr
                .best_idx
                .map(|i| i.to_string())
                .unwrap_or_else(|| "null".to_string());

            format!(
                "{{\"weights\":{w},\"risks\":{r},\"returns\":{ret},\
                 \"sharpes\":{s},\"best_idx\":{bi},\
                 \"n_portfolios\":{k},\"n_assets\":{n},\
                 \"implied_returns\":{ir},\"posterior_mu\":{pm}}}",
                w   = vec_to_json(&w_flat),
                r   = vec_to_json(fr.risks.as_slice()),
                ret = vec_to_json(fr.returns.as_slice()),
                s   = vec_to_json(fr.sharpes.as_slice()),
                bi  = best_idx,
                ir  = vec_to_json(bl.implied_returns.as_slice()),
                pm  = vec_to_json(bl.posterior_mu.as_slice()),
            )
        }
    }
}

// ---------------------------------------------------------------------------
// Regime detection
// ---------------------------------------------------------------------------

/// Fit a Gaussian HMM to a return series and decode market regimes.
///
/// `returns_flat`: T-element return vector.
/// `n_regimes`: number of hidden states (2 or 3 recommended).
/// `max_iter`: maximum Baum-Welch iterations.
/// `seed`: RNG seed for initialisation perturbation.
///
/// Returns JSON:
/// `{"n_regimes":int,"state_sequence":[...],"state_probabilities":[[...],...]`,
/// `"regime_means":[...],"regime_vols":[...],"transition_matrix":[[...],...]`,
/// `"stationary_dist":[...]}`
#[wasm_bindgen]
pub fn detect_regimes_wasm(
    returns_flat: Vec<f64>,
    n_regimes: usize,
    max_iter: usize,
    seed: u64,
) -> String {
    let rets = DVector::from_vec(returns_flat);
    match detect_regimes(&rets, n_regimes, max_iter, 1e-6, seed) {
        Err(e) => err_json(&e.to_string()),
        Ok(r) => {
            // state_probabilities: array of T arrays of length K
            let probs_json: String = {
                let rows: Vec<String> = r
                    .state_probabilities
                    .iter()
                    .map(|row| vec_to_json(row))
                    .collect();
                format!("[{}]", rows.join(","))
            };

            // transition_matrix: K × K nested array
            let trans_json: String = {
                let rows: Vec<String> = r
                    .transition_matrix
                    .iter()
                    .map(|row| vec_to_json(row))
                    .collect();
                format!("[{}]", rows.join(","))
            };

            // state_sequence as JSON int array
            let seq_json: String = {
                let parts: Vec<String> = r.state_sequence.iter().map(|s| s.to_string()).collect();
                format!("[{}]", parts.join(","))
            };

            format!(
                "{{\"n_regimes\":{k},\
                 \"state_sequence\":{seq},\
                 \"state_probabilities\":{probs},\
                 \"regime_means\":{means},\
                 \"regime_vols\":{vols},\
                 \"transition_matrix\":{trans},\
                 \"stationary_dist\":{stat}}}",
                k     = r.n_regimes,
                seq   = seq_json,
                probs = probs_json,
                means = vec_to_json(&r.regime_means),
                vols  = vec_to_json(&r.regime_vols),
                trans = trans_json,
                stat  = vec_to_json(&r.stationary_dist),
            )
        }
    }
}

// ---------------------------------------------------------------------------
// Factor risk decomposition
// ---------------------------------------------------------------------------

/// OLS factor risk decomposition.
///
/// `portfolio_returns`: T-element portfolio return vector.
/// `factor_returns_flat`: T × K factor return matrix, row-major.
/// `n_periods`: T (number of return observations).
/// `n_factors`: K (number of factors).
/// `factor_names_json`: JSON array of factor name strings.
/// `ppy`: periods per year for annualisation.
///
/// Returns JSON:
/// `{"factor_names":[...],"betas":[...],"factor_risk_contributions":[...],`
/// `"specific_risk_pct":...,"r_squared":...,"alpha":...,"tracking_error":...`,
/// `"information_ratio":...,"t_stats":[...]}`
#[wasm_bindgen]
pub fn decompose_factor_risk(
    portfolio_returns: Vec<f64>,
    factor_returns_flat: Vec<f64>,
    n_periods: usize,
    n_factors: usize,
    factor_names_json: String,
    ppy: usize,
) -> String {
    if factor_returns_flat.len() != n_periods * n_factors {
        return err_json(&format!(
            "factor_returns_flat length {} != {} periods × {} factors",
            factor_returns_flat.len(),
            n_periods,
            n_factors,
        ));
    }

    let port = DVector::from_vec(portfolio_returns);

    // Rust DMatrix::from_vec is column-major; our flat data is row-major.
    // Build row-major → column-major conversion manually.
    let factor_mat = DMatrix::from_fn(n_periods, n_factors, |r, c| {
        factor_returns_flat[r * n_factors + c]
    });

    let names: Vec<String> = match serde_json::from_str(&factor_names_json) {
        Ok(v) => v,
        Err(e) => return err_json(&format!("invalid factor_names_json: {e}")),
    };

    match decompose_factors(&port, &factor_mat, &names, ppy) {
        Err(e) => err_json(&e.to_string()),
        Ok(d) => {
            format!(
                "{{\"factor_names\":{names},\
                 \"betas\":{betas},\
                 \"factor_risk_contributions\":{frc},\
                 \"specific_risk_pct\":{srp},\
                 \"r_squared\":{r2},\
                 \"alpha\":{alpha},\
                 \"tracking_error\":{te},\
                 \"information_ratio\":{ir},\
                 \"t_stats\":{ts}}}",
                names = factor_names_json,
                betas = vec_to_json(d.betas.as_slice()),
                frc   = vec_to_json(d.factor_risk_contributions.as_slice()),
                srp   = d.specific_risk_pct,
                r2    = d.r_squared,
                alpha = d.alpha,
                te    = d.tracking_error,
                ir    = d.information_ratio,
                ts    = vec_to_json(d.t_stats.as_slice()),
            )
        }
    }
}
