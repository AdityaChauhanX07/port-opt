//! Gaussian Hidden Markov Model for market regime detection.
//!
//! Uses Baum-Welch EM to fit K-state Gaussian HMM to a return series,
//! then Viterbi to decode the most likely state sequence.

use nalgebra::DVector;

use crate::EngineError;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

pub struct RegimeResult {
    pub n_regimes: usize,
    pub state_sequence: Vec<usize>,
    pub state_probabilities: Vec<Vec<f64>>,
    pub regime_means: Vec<f64>,
    pub regime_vols: Vec<f64>,
    pub transition_matrix: Vec<Vec<f64>>,
    pub stationary_dist: Vec<f64>,
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

#[inline]
fn log_gaussian(x: f64, mu: f64, sigma: f64) -> f64 {
    let s2 = sigma * sigma;
    -0.5 * (2.0 * std::f64::consts::PI * s2).ln() - 0.5 * (x - mu).powi(2) / s2
}

/// Numerically-stable log-sum-exp of a slice.
fn log_sum_exp(vals: &[f64]) -> f64 {
    let max = vals.iter().cloned().fold(f64::NEG_INFINITY, f64::max);
    if max.is_infinite() {
        return f64::NEG_INFINITY;
    }
    max + vals.iter().map(|v| (v - max).exp()).sum::<f64>().ln()
}

// ---------------------------------------------------------------------------
// Forward-backward (log space)
// ---------------------------------------------------------------------------

/// Returns (log_alpha, log_beta, log_likelihood).
fn forward_backward(
    log_obs: &[Vec<f64>],  // T × K
    log_pi: &[f64],        // K initial log-probs
    log_a: &[Vec<f64>],    // K × K log-transition
    t_len: usize,
    k: usize,
) -> (Vec<Vec<f64>>, Vec<Vec<f64>>, f64) {
    // Forward pass
    let mut log_alpha = vec![vec![0.0_f64; k]; t_len];
    for j in 0..k {
        log_alpha[0][j] = log_pi[j] + log_obs[0][j];
    }
    for t in 1..t_len {
        for j in 0..k {
            let tmp: Vec<f64> = (0..k)
                .map(|i| log_alpha[t - 1][i] + log_a[i][j])
                .collect();
            log_alpha[t][j] = log_sum_exp(&tmp) + log_obs[t][j];
        }
    }

    // Log-likelihood
    let log_lik = log_sum_exp(&log_alpha[t_len - 1]);

    // Backward pass
    let mut log_beta = vec![vec![0.0_f64; k]; t_len];
    // log_beta[T-1][j] = log(1) = 0 for all j
    for t in (0..t_len - 1).rev() {
        for i in 0..k {
            let tmp: Vec<f64> = (0..k)
                .map(|j| log_a[i][j] + log_obs[t + 1][j] + log_beta[t + 1][j])
                .collect();
            log_beta[t][i] = log_sum_exp(&tmp);
        }
    }

    (log_alpha, log_beta, log_lik)
}

// ---------------------------------------------------------------------------
// Viterbi
// ---------------------------------------------------------------------------

fn viterbi(
    log_obs: &[Vec<f64>],
    log_pi: &[f64],
    log_a: &[Vec<f64>],
    t_len: usize,
    k: usize,
) -> Vec<usize> {
    let mut delta = vec![vec![0.0_f64; k]; t_len];
    let mut psi = vec![vec![0_usize; k]; t_len];

    for j in 0..k {
        delta[0][j] = log_pi[j] + log_obs[0][j];
    }
    for t in 1..t_len {
        for j in 0..k {
            let (best_i, best_val) = (0..k)
                .map(|i| (i, delta[t - 1][i] + log_a[i][j]))
                .max_by(|a, b| a.1.partial_cmp(&b.1).unwrap())
                .unwrap();
            delta[t][j] = best_val + log_obs[t][j];
            psi[t][j] = best_i;
        }
    }

    // Backtrack
    let mut seq = vec![0_usize; t_len];
    seq[t_len - 1] = (0..k)
        .max_by(|&a, &b| delta[t_len - 1][a].partial_cmp(&delta[t_len - 1][b]).unwrap())
        .unwrap();
    for t in (0..t_len - 1).rev() {
        seq[t] = psi[t + 1][seq[t + 1]];
    }
    seq
}

// ---------------------------------------------------------------------------
// Stationary distribution (dominant left eigenvector of A)
// Power-iteration on the transpose.
// ---------------------------------------------------------------------------

fn stationary_dist(a: &[Vec<f64>], k: usize) -> Vec<f64> {
    let mut v = vec![1.0 / k as f64; k];
    for _ in 0..1000 {
        let mut next = vec![0.0_f64; k];
        for j in 0..k {
            for i in 0..k {
                next[j] += v[i] * a[i][j];
            }
        }
        let s: f64 = next.iter().sum();
        for x in &mut next {
            *x /= s;
        }
        let diff: f64 = v.iter().zip(&next).map(|(a, b)| (a - b).abs()).sum();
        v = next;
        if diff < 1e-12 {
            break;
        }
    }
    v
}

// ---------------------------------------------------------------------------
// Initialise parameters using return quantile buckets
// ---------------------------------------------------------------------------

fn init_params(returns: &[f64], k: usize, seed: u64) -> (Vec<f64>, Vec<f64>, Vec<Vec<f64>>, Vec<f64>) {
    let t = returns.len();
    let mut sorted = returns.to_vec();
    sorted.sort_by(|a, b| a.partial_cmp(b).unwrap());

    // Quantile bucket means / vols
    let mut means = vec![0.0_f64; k];
    let mut vols = vec![0.0_f64; k];
    for i in 0..k {
        let lo = (i * t) / k;
        let hi = ((i + 1) * t) / k;
        let bucket = &sorted[lo..hi.min(t)];
        let m = bucket.iter().sum::<f64>() / bucket.len() as f64;
        let v = (bucket.iter().map(|x| (x - m).powi(2)).sum::<f64>() / bucket.len() as f64)
            .sqrt()
            .max(1e-6);
        // Sort by mean ascending so state 0 = bear, state k-1 = bull
        means[i] = m;
        vols[i] = v;
    }

    // Slightly perturb with deterministic LCG to avoid degeneracy
    let mut rng = seed.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
    for i in 0..k {
        rng = rng.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
        let eps = ((rng >> 33) as f64 / u32::MAX as f64 - 0.5) * 0.001;
        means[i] += eps;
    }

    // Near-uniform initial transition matrix with slight self-loop preference
    let stay = 0.7_f64;
    let leave = (1.0 - stay) / (k - 1).max(1) as f64;
    let a: Vec<Vec<f64>> = (0..k)
        .map(|i| (0..k).map(|j| if i == j { stay } else { leave }).collect())
        .collect();

    // Uniform initial state distribution
    let pi = vec![1.0 / k as f64; k];

    (means, vols, a, pi)
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

pub fn detect_regimes(
    returns: &DVector<f64>,
    n_regimes: usize,
    max_iter: usize,
    tol: f64,
    seed: u64,
) -> Result<RegimeResult, EngineError> {
    let k = n_regimes;
    let t_len = returns.len();

    if k < 2 {
        return Err(EngineError::InvalidInput(
            "n_regimes must be >= 2".into(),
        ));
    }
    if t_len < k * 10 {
        return Err(EngineError::InsufficientData(
            "too few observations for regime count".into(),
        ));
    }

    let ret_slice: Vec<f64> = returns.iter().cloned().collect();
    let (mut means, mut vols, mut a, mut pi) = init_params(&ret_slice, k, seed);

    let mut prev_log_lik = f64::NEG_INFINITY;

    for _iter in 0..max_iter {
        // --- E-step ---

        // Observation log-likelihoods: T × K
        let log_obs: Vec<Vec<f64>> = ret_slice
            .iter()
            .map(|&x| (0..k).map(|j| log_gaussian(x, means[j], vols[j])).collect())
            .collect();

        let log_pi: Vec<f64> = pi.iter().map(|p| p.ln()).collect();
        let log_a: Vec<Vec<f64>> = a
            .iter()
            .map(|row| row.iter().map(|p| p.ln()).collect())
            .collect();

        let (log_alpha, log_beta, log_lik) =
            forward_backward(&log_obs, &log_pi, &log_a, t_len, k);

        // Check convergence
        if (log_lik - prev_log_lik).abs() < tol {
            break;
        }
        prev_log_lik = log_lik;

        // Compute gamma (T × K): log P(z_t = j | obs)
        let mut gamma = vec![vec![0.0_f64; k]; t_len];
        for t in 0..t_len {
            let log_denom: Vec<f64> = (0..k)
                .map(|j| log_alpha[t][j] + log_beta[t][j])
                .collect();
            let denom = log_sum_exp(&log_denom);
            for j in 0..k {
                gamma[t][j] = (log_alpha[t][j] + log_beta[t][j] - denom).exp();
            }
        }

        // Compute xi (T-1 × K × K): P(z_t=i, z_{t+1}=j | obs)
        // We only need sums over t, so accumulate directly.
        let mut xi_sum = vec![vec![0.0_f64; k]; k];
        for t in 0..t_len - 1 {
            let mut log_xi = vec![vec![0.0_f64; k]; k];
            let mut vals: Vec<f64> = Vec::with_capacity(k * k);
            for i in 0..k {
                for j in 0..k {
                    let v = log_alpha[t][i]
                        + log_a[i][j]
                        + log_obs[t + 1][j]
                        + log_beta[t + 1][j];
                    log_xi[i][j] = v;
                    vals.push(v);
                }
            }
            let denom = log_sum_exp(&vals);
            for i in 0..k {
                for j in 0..k {
                    xi_sum[i][j] += (log_xi[i][j] - denom).exp();
                }
            }
        }

        // --- M-step ---

        // Update pi
        for j in 0..k {
            pi[j] = gamma[0][j].max(1e-300);
        }
        let pi_sum: f64 = pi.iter().sum();
        for p in &mut pi {
            *p /= pi_sum;
        }

        // Update transition matrix
        for i in 0..k {
            let row_sum: f64 = xi_sum[i].iter().sum::<f64>().max(1e-300);
            for j in 0..k {
                a[i][j] = (xi_sum[i][j] / row_sum).max(1e-300);
            }
            // Renormalise row
            let s: f64 = a[i].iter().sum();
            for p in &mut a[i] {
                *p /= s;
            }
        }

        // Update emission parameters (means and vols)
        for j in 0..k {
            let g_sum: f64 = gamma.iter().map(|row| row[j]).sum::<f64>().max(1e-300);
            let new_mean: f64 =
                gamma.iter().zip(&ret_slice).map(|(row, &r)| row[j] * r).sum::<f64>() / g_sum;
            let new_var: f64 = gamma
                .iter()
                .zip(&ret_slice)
                .map(|(row, &r)| row[j] * (r - new_mean).powi(2))
                .sum::<f64>()
                / g_sum;
            means[j] = new_mean;
            vols[j] = new_var.sqrt().max(1e-6);
        }
    }

    // --- Final decode ---

    let log_obs_final: Vec<Vec<f64>> = ret_slice
        .iter()
        .map(|&x| (0..k).map(|j| log_gaussian(x, means[j], vols[j])).collect())
        .collect();
    let log_pi_final: Vec<f64> = pi.iter().map(|p| p.ln()).collect();
    let log_a_final: Vec<Vec<f64>> = a
        .iter()
        .map(|row| row.iter().map(|p| p.ln()).collect())
        .collect();

    let state_sequence = viterbi(&log_obs_final, &log_pi_final, &log_a_final, t_len, k);

    // Posterior state probabilities (gamma at convergence)
    let (log_alpha_f, log_beta_f, _) =
        forward_backward(&log_obs_final, &log_pi_final, &log_a_final, t_len, k);

    let state_probabilities: Vec<Vec<f64>> = (0..t_len)
        .map(|t| {
            let log_denom: Vec<f64> = (0..k)
                .map(|j| log_alpha_f[t][j] + log_beta_f[t][j])
                .collect();
            let denom = log_sum_exp(&log_denom);
            (0..k)
                .map(|j| (log_alpha_f[t][j] + log_beta_f[t][j] - denom).exp())
                .collect()
        })
        .collect();

    let stationary = stationary_dist(&a, k);

    Ok(RegimeResult {
        n_regimes: k,
        state_sequence,
        state_probabilities,
        regime_means: means,
        regime_vols: vols,
        transition_matrix: a,
        stationary_dist: stationary,
    })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use nalgebra::DVector;

    fn make_returns(bull: &[f64], bear: &[f64], interleave_n: usize) -> DVector<f64> {
        let mut v = Vec::new();
        for _ in 0..interleave_n {
            v.extend_from_slice(bull);
            v.extend_from_slice(bear);
        }
        DVector::from_vec(v)
    }

    #[test]
    fn test_two_regime_synthetic() {
        // Clear separation: bull ~ N(0.001, 0.005), bear ~ N(-0.003, 0.015)
        let bull: Vec<f64> = (0..30).map(|i| 0.001 + (i as f64 * 0.0001).sin() * 0.004).collect();
        let bear: Vec<f64> = (0..30).map(|i| -0.003 + (i as f64 * 0.0001).cos() * 0.012).collect();
        let returns = make_returns(&bull, &bear, 4);

        let result = detect_regimes(&returns, 2, 100, 1e-6, 42).unwrap();

        assert_eq!(result.n_regimes, 2);
        assert_eq!(result.state_sequence.len(), returns.len());

        // The two regimes should have clearly different means
        let mean_diff = (result.regime_means[0] - result.regime_means[1]).abs();
        assert!(mean_diff > 0.0005, "regime means should differ: {mean_diff}");

        // Stationary distribution should sum to 1
        let stat_sum: f64 = result.stationary_dist.iter().sum();
        assert!((stat_sum - 1.0).abs() < 1e-6);
    }

    #[test]
    fn test_single_distribution_converges() {
        // i.i.d. returns — HMM should still converge without panicking
        let returns: Vec<f64> = (0..200)
            .map(|i| 0.0005 * ((i as f64 * 0.3).sin()))
            .collect();
        let dv = DVector::from_vec(returns);
        let result = detect_regimes(&dv, 2, 50, 1e-4, 7).unwrap();
        assert_eq!(result.state_sequence.len(), dv.len());
    }

    #[test]
    fn test_transition_rows_sum_to_one() {
        let returns: Vec<f64> = (0..150)
            .map(|i| (i as f64 * 0.07).sin() * 0.01)
            .collect();
        let dv = DVector::from_vec(returns);
        let result = detect_regimes(&dv, 3, 80, 1e-5, 99).unwrap();
        for row in &result.transition_matrix {
            let s: f64 = row.iter().sum();
            assert!((s - 1.0).abs() < 1e-9, "transition row sum: {s}");
        }
    }
}
