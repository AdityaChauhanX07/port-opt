//! Walk-forward backtest with rolling window re-optimisation.
//!
//! At each rebalance date the estimator:
//! 1. Takes the most recent `window` periods as the training set.
//! 2. Annualises mean and covariance (`stats::annualize`).
//! 3. Applies diagonal shrinkage (`stats::shrink_ledoit_wolf`).
//! 4. Traces the efficient frontier and selects the max-Sharpe portfolio.
//! 5. Falls back to equal weights if optimisation fails.
//! 6. Applies a flat transaction-cost drag on the first return after each rebalance.
//!
//! Mirrors `backtest.backtest_walkforward` from the Python reference.

use nalgebra::{DMatrix, DVector};

use crate::backtest::costs::flat_cost;
use crate::optimize::trace;
use crate::stats::{annualize, drawdown, equity_curve, portfolio_returns, shrink_ledoit_wolf};
use crate::EngineError;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/// Configuration for the walk-forward engine.
#[derive(Debug, Clone)]
pub struct WalkforwardConfig {
    /// Training window length (number of periods).
    pub window: usize,
    /// Number of periods between rebalances.
    pub step: usize,
    /// Transaction cost (decimal, e.g. 0.0005 = 5 bps).
    pub tc_bps: f64,
    /// Slippage (decimal).
    pub slippage_bps: f64,
    /// Enforce long-only constraint during optimisation.
    pub long_only: bool,
    /// Per-asset weight lower bound.
    pub lb: f64,
    /// Per-asset weight upper bound.
    pub ub: f64,
    /// Shrinkage intensity for the diagonal covariance target (`0` = no shrink).
    pub shrinkage_alpha: f64,
    /// Number of target-return grid points for frontier tracing.
    pub n_pts: usize,
    /// Annualised risk-free rate (used for Sharpe selection).
    pub rf: f64,
    /// Periods per year (for annualisation).
    pub ppy: usize,
}

/// Output of a walk-forward backtest.
pub struct WalkforwardResult {
    /// Portfolio equity curve over the walk-forward period (length = T − window).
    pub portfolio_equity: DVector<f64>,
    /// Period-by-period portfolio net returns (length = T − window).
    pub portfolio_returns: DVector<f64>,
    /// Drawdown series (length = T − window).
    pub portfolio_dd: DVector<f64>,
    /// Weight matrix — one row per rebalance, shape `(n_rebalances × n_assets)`.
    pub weights_history: DMatrix<f64>,
    /// Row indices (into the original returns matrix) at which rebalances occurred.
    pub rebalance_indices: Vec<usize>,
    /// Equal-weight benchmark equity over the full return period (length = T).
    pub ew_equity: Option<DVector<f64>>,
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/// Run a walk-forward backtest.
///
/// `returns` — `(T × n_assets)` matrix of per-period returns.
///
/// # Errors
/// Returns [`EngineError::InvalidInput`] when there is insufficient data.
pub fn run(returns: &DMatrix<f64>, config: &WalkforwardConfig) -> Result<WalkforwardResult, EngineError> {
    let t_total = returns.nrows();
    let n = returns.ncols();

    if n == 0 {
        return Err(EngineError::InvalidInput("returns matrix has no assets".into()));
    }
    if t_total <= config.window + config.step {
        return Err(EngineError::InvalidInput(format!(
            "need > window + step = {} observations, got {t_total}",
            config.window + config.step
        )));
    }
    if config.ppy == 0 {
        return Err(EngineError::InvalidInput("ppy must be > 0".into()));
    }

    // -----------------------------------------------------------------------
    // Walk-forward loop
    // -----------------------------------------------------------------------
    let wf_len = t_total - config.window; // periods in the walk-forward range
    let mut port_rets = vec![0.0f64; wf_len]; // index 0 ↔ global row `window`

    let mut current_w: DVector<f64> = DVector::from_element(n, 1.0 / n as f64);
    let mut weights_history: Vec<DVector<f64>> = Vec::new();
    let mut rebalance_indices: Vec<usize> = Vec::new();
    let mut first_rebalance = true;

    let mut i = config.window; // global row index of the current rebalance
    while i < t_total {
        // ------ Training window ------
        let train = returns.rows(i - config.window, config.window);
        // Convert MatrixSlice to DMatrix
        let train_mat = DMatrix::from_fn(config.window, n, |r, c| train[(r, c)]);

        let w_new: DVector<f64> = {
            let opt_result = (|| -> Option<DVector<f64>> {
                let (mu, cov) = annualize(&train_mat, config.ppy).ok()?;
                let cov_s = shrink_ledoit_wolf(&cov, config.shrinkage_alpha);
                let fr = trace(&mu, &cov_s, config.n_pts, config.long_only,
                               config.lb, config.ub, config.rf).ok()?;
                let best = fr.best_idx?;
                Some(DVector::from_fn(n, |j, _| fr.weights[(best, j)]))
            })();
            opt_result.unwrap_or_else(|| DVector::from_element(n, 1.0 / n as f64))
        };

        // ------ Transaction costs ------
        let cost_rate = if first_rebalance {
            first_rebalance = false;
            0.0
        } else {
            let turnover: f64 = (&w_new - &current_w).abs().sum();
            flat_cost(turnover, config.tc_bps, config.slippage_bps)
        };

        current_w = w_new;
        weights_history.push(current_w.clone());
        rebalance_indices.push(i);

        // ------ Apply weights for the next `step` periods ------
        let j_end = (i + config.step).min(t_total);
        for j in i..j_end {
            let r_gross: f64 = (0..n).map(|k| returns[(j, k)] * current_w[k]).sum();
            let wf_idx = j - config.window; // position in port_rets
            port_rets[wf_idx] = if j == i && cost_rate > 0.0 {
                (1.0 - cost_rate) * (1.0 + r_gross) - 1.0
            } else {
                r_gross
            };
        }

        i += config.step;
    }

    // -----------------------------------------------------------------------
    // Assemble outputs
    // -----------------------------------------------------------------------
    let port_rets_vec = DVector::from_vec(port_rets);
    let port_eq = equity_curve(&port_rets_vec, 1.0);
    let port_dd = drawdown(&port_eq);

    // Equal-weight benchmark over the full period.
    let ew_equity = {
        let ew_w = DVector::from_element(n, 1.0 / n as f64);
        portfolio_returns(returns, &ew_w)
            .ok()
            .map(|r| equity_curve(&r, 1.0))
    };

    // Pack weight history into a matrix (n_rebalances × n_assets).
    let n_reb = weights_history.len();
    let wh = DMatrix::from_fn(n_reb, n, |r, c| weights_history[r][c]);

    Ok(WalkforwardResult {
        portfolio_equity: port_eq,
        portfolio_returns: port_rets_vec,
        portfolio_dd: port_dd,
        weights_history: wh,
        rebalance_indices,
        ew_equity,
    })
}
