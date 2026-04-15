//! Static (fixed-weight) backtest.
//!
//! Applies constant portfolio weights to a per-period returns matrix,
//! then computes equity curves and drawdowns.  Optionally includes
//! an equal-weight benchmark.

use nalgebra::{DMatrix, DVector};

use crate::stats::{drawdown, equity_curve, portfolio_returns};
use crate::EngineError;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/// Output of a static backtest.
pub struct StaticBacktestResult {
    /// Portfolio equity curve (starting at 1.0), length = n_periods.
    pub portfolio_equity: DVector<f64>,
    /// Period-by-period portfolio returns, length = n_periods.
    pub portfolio_returns: DVector<f64>,
    /// Portfolio drawdown series (≤ 0), length = n_periods.
    pub portfolio_dd: DVector<f64>,
    /// Equal-weight benchmark equity curve (if requested).
    pub ew_equity: Option<DVector<f64>>,
    /// Equal-weight drawdown series (if requested).
    pub ew_dd: Option<DVector<f64>>,
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/// Run a static backtest.
///
/// `returns` — `(T × n_assets)` matrix of per-period returns.
/// `weights` — `n_assets` weight vector (need not sum to 1; used as-is).
/// `include_ew` — whether to compute the equal-weight benchmark.
///
/// # Errors
/// Returns [`EngineError::InvalidInput`] if dimensions are mismatched or empty.
pub fn run(
    returns: &DMatrix<f64>,
    weights: &DVector<f64>,
    include_ew: bool,
) -> Result<StaticBacktestResult, EngineError> {
    let t = returns.nrows();
    let n = returns.ncols();

    if n == 0 || t == 0 {
        return Err(EngineError::InvalidInput("returns matrix is empty".into()));
    }
    if weights.len() != n {
        return Err(EngineError::InvalidInput(format!(
            "weights length {} does not match asset count {}",
            weights.len(),
            n
        )));
    }

    // Portfolio returns and equity curve.
    let port_rets = portfolio_returns(returns, weights)
        .map_err(EngineError::InvalidInput)?;
    let port_eq = equity_curve(&port_rets, 1.0);
    let port_dd = drawdown(&port_eq);

    // Equal-weight benchmark.
    let (ew_equity, ew_dd) = if include_ew {
        let ew_w = DVector::from_element(n, 1.0 / n as f64);
        let ew_rets = portfolio_returns(returns, &ew_w)
            .map_err(EngineError::InvalidInput)?;
        let eq = equity_curve(&ew_rets, 1.0);
        let dd = drawdown(&eq);
        (Some(eq), Some(dd))
    } else {
        (None, None)
    };

    Ok(StaticBacktestResult {
        portfolio_equity: port_eq,
        portfolio_returns: port_rets,
        portfolio_dd: port_dd,
        ew_equity,
        ew_dd,
    })
}
