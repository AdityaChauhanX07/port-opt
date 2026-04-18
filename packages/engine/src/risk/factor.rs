//! Factor risk decomposition via OLS regression.
//!
//! Regresses portfolio returns on a set of factor returns, then attributes
//! total variance to systematic (factor) and idiosyncratic (specific) components.

use nalgebra::{DMatrix, DVector};

use crate::EngineError;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

pub struct FactorDecomposition {
    pub factor_names: Vec<String>,
    /// OLS factor loadings, length K.
    pub betas: DVector<f64>,
    /// Per-factor % share of total variance (approximate, ignoring cross-terms).
    pub factor_risk_contributions: DVector<f64>,
    /// Idiosyncratic risk as % of total variance.
    pub specific_risk_pct: f64,
    /// R² of the regression.
    pub r_squared: f64,
    /// Annualised intercept (Jensen's alpha).
    pub alpha: f64,
    /// Annualised tracking error (std of residuals).
    pub tracking_error: f64,
    /// Information ratio = alpha / tracking_error.
    pub information_ratio: f64,
    /// OLS t-statistics for each factor beta, length K.
    pub t_stats: DVector<f64>,
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/// Decompose portfolio risk into factor and idiosyncratic components.
///
/// `portfolio_returns`: T-length return series.
/// `factor_returns`:    T × K matrix (row-major), one column per factor.
/// `ppy`:               Periods per year for annualisation.
pub fn decompose(
    portfolio_returns: &DVector<f64>,
    factor_returns: &DMatrix<f64>,
    factor_names: &[String],
    ppy: usize,
) -> Result<FactorDecomposition, EngineError> {
    let t = portfolio_returns.len();
    let k = factor_returns.ncols();

    if factor_returns.nrows() != t {
        return Err(EngineError::InvalidInput(format!(
            "factor_returns has {} rows but portfolio_returns has {t} elements",
            factor_returns.nrows()
        )));
    }
    if t < k + 2 {
        return Err(EngineError::InsufficientData(
            "too few observations for factor regression".into(),
        ));
    }
    if factor_names.len() != k {
        return Err(EngineError::InvalidInput(
            "factor_names length must equal n_factors".into(),
        ));
    }

    let ppy_f = ppy as f64;

    // ── Build design matrix X = [1 | F] (T × K+1) ──────────────────────────
    // Column 0 is the intercept (ones vector); columns 1..=K are factor returns.
    let k1 = k + 1;
    let mut x = DMatrix::<f64>::zeros(t, k1);
    for row in 0..t {
        x[(row, 0)] = 1.0;
        for col in 0..k {
            x[(row, col + 1)] = factor_returns[(row, col)];
        }
    }

    // ── OLS via SVD: β̂ = pinv(X) · r_p ───────────────────────────────────
    let svd = x.clone().svd(true, true);
    let coeffs = svd
        .solve(portfolio_returns, 1e-12)
        .map_err(|_| EngineError::OptimizationFailed("OLS SVD failed".into()))?;

    let alpha_per_period = coeffs[0];
    let betas = DVector::from_iterator(k, coeffs.iter().skip(1).cloned());

    // ── Residuals ──────────────────────────────────────────────────────────
    let fitted = &x * &coeffs;
    let residuals = portfolio_returns - &fitted;

    // ── Variance decomposition ─────────────────────────────────────────────
    let mean_rp = portfolio_returns.mean();
    let _total_var: f64 = portfolio_returns
        .iter()
        .map(|&r| (r - mean_rp).powi(2))
        .sum::<f64>()
        / (t - 1) as f64;

    let specific_var: f64 = {
        let mean_res = residuals.mean();
        residuals
            .iter()
            .map(|&r| (r - mean_res).powi(2))
            .sum::<f64>()
            / (t - 1).max(1) as f64
    };

    // Per-factor variance: β_k² · var(f_k)
    let factor_vars: Vec<f64> = (0..k)
        .map(|j| {
            let col = factor_returns.column(j);
            let mu = col.mean();
            let v = col.iter().map(|&x| (x - mu).powi(2)).sum::<f64>() / (t - 1) as f64;
            betas[j].powi(2) * v
        })
        .collect();

    // R² = 1 - SS_res/SS_tot
    let ss_res: f64 = residuals.iter().map(|&r| r.powi(2)).sum();
    let ss_tot: f64 = portfolio_returns
        .iter()
        .map(|&r| (r - mean_rp).powi(2))
        .sum();
    let r_squared = if ss_tot > 0.0 {
        (1.0 - ss_res / ss_tot).max(0.0).min(1.0)
    } else {
        0.0
    };

    // Factor risk contributions: normalize so they sum to R² exactly.
    // This ensures factor_contributions.sum() + specific_risk_pct == 1.0.
    let raw_sum: f64 = factor_vars.iter().sum::<f64>().max(1e-300);
    let factor_risk_contributions: DVector<f64> = DVector::from_iterator(
        k,
        factor_vars.iter().map(|&fv| fv / raw_sum * r_squared),
    );

    let specific_risk_pct = (1.0 - r_squared).max(0.0);

    // ── Tracking error & IR ────────────────────────────────────────────────
    let tracking_error = specific_var.sqrt() * ppy_f.sqrt();
    let alpha_ann = alpha_per_period * ppy_f;
    let information_ratio = if tracking_error.abs() > 1e-12 {
        alpha_ann / tracking_error
    } else {
        0.0
    };

    // ── t-statistics ──────────────────────────────────────────────────────
    // SE(β_k) = sqrt(σ²_ε · [(X'X)⁻¹]_{k+1,k+1})
    let xpx = x.transpose() * &x;
    let xpx_inv = xpx.pseudo_inverse(1e-12).unwrap_or_else(|_| {
        DMatrix::zeros(k1, k1)
    });
    let sigma2_eps = ss_res / (t - k1) as f64;

    let t_stats: DVector<f64> = DVector::from_iterator(k, (0..k).map(|j| {
        let se2 = sigma2_eps * xpx_inv[(j + 1, j + 1)];
        if se2 > 0.0 { betas[j] / se2.sqrt() } else { 0.0 }
    }));

    Ok(FactorDecomposition {
        factor_names: factor_names.to_vec(),
        betas,
        factor_risk_contributions,
        specific_risk_pct,
        r_squared,
        alpha: alpha_ann,
        tracking_error,
        information_ratio,
        t_stats,
    })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use nalgebra::{DMatrix, DVector};

    fn make_names(k: usize) -> Vec<String> {
        (0..k).map(|i| format!("F{i}")).collect()
    }

    #[test]
    fn test_beta_one_market() {
        // r_p = 1.0 * r_market  → beta ≈ 1, R² ≈ 1
        let t = 300;
        let mkt: Vec<f64> = (0..t)
            .map(|i| 0.001 * (i as f64 * 0.1).sin())
            .collect();
        let port = DVector::from_vec(mkt.clone());
        let factors = DMatrix::from_vec(t, 1, mkt);

        let result = decompose(&port, &factors, &make_names(1), 252).unwrap();

        assert!((result.betas[0] - 1.0).abs() < 1e-6, "beta={}", result.betas[0]);
        assert!(result.r_squared > 0.9999, "R²={}", result.r_squared);
    }

    #[test]
    fn test_pure_noise_low_r2() {
        // r_p uncorrelated with factor → R² ≈ 0, betas near 0
        let t = 500;
        let port: Vec<f64> = (0..t)
            .map(|i| (i as f64 * 1.7).sin() * 0.01)
            .collect();
        let fac: Vec<f64> = (0..t)
            .map(|i| (i as f64 * 3.1).cos() * 0.01)
            .collect();
        let pv = DVector::from_vec(port);
        let fv = DMatrix::from_vec(t, 1, fac);

        let result = decompose(&pv, &fv, &make_names(1), 252).unwrap();
        assert!(result.r_squared < 0.1, "R²={}", result.r_squared);
    }

    #[test]
    fn test_contributions_sum_le_one() {
        // 2-factor model — factor contributions + specific ≤ 1
        let t = 300;
        let f1: Vec<f64> = (0..t).map(|i| (i as f64 * 0.1).sin() * 0.01).collect();
        let f2: Vec<f64> = (0..t).map(|i| (i as f64 * 0.2).cos() * 0.01).collect();
        let port: Vec<f64> = f1
            .iter()
            .zip(&f2)
            .map(|(&a, &b)| 0.6 * a + 0.4 * b + 0.003 * a.powi(2))
            .collect();

        let mut fmat = vec![0.0f64; t * 2];
        for i in 0..t {
            fmat[i] = f1[i];
            fmat[i + t] = f2[i];
        }
        let factors = DMatrix::from_vec(t, 2, fmat);
        let pv = DVector::from_vec(port);

        let result = decompose(&pv, &factors, &make_names(2), 252).unwrap();

        let total: f64 = result.factor_risk_contributions.sum() + result.specific_risk_pct;
        assert!(total <= 1.001, "contributions + specific = {total}");
    }
}
