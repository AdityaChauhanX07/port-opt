#!/usr/bin/env python3
"""
scripts/compare-with-v1.py

Generates 6-asset × 500-period synthetic returns (numpy seed 42), runs the
Python v1 portfolio algorithms (Markowitz, HRP, risk-parity), and writes the
raw data plus algorithm outputs to scripts/compare-data.json.

Usage:
    python scripts/compare-with-v1.py

The compare-with-v1.mjs script reads compare-data.json and runs the same data
through the WASM engine, then reports numerical diffs.
"""
from __future__ import annotations

import json
import sys
import os
from pathlib import Path

import numpy as np

# ---------------------------------------------------------------------------
# Locate repo root and add src/ to path so we can import portopt.core
# ---------------------------------------------------------------------------
REPO_ROOT = Path(__file__).resolve().parent.parent
SRC_DIR   = REPO_ROOT / "src"
sys.path.insert(0, str(SRC_DIR))

from portopt.core.opt import (
    trace_efficient_frontier,
    pick_max_sharpe,
    risk_parity_weights,
)
from portopt.core.hrp import hrp_weights

import pandas as pd

# ---------------------------------------------------------------------------
# Synthetic data parameters  (must match verify-wasm.mjs exactly)
# ---------------------------------------------------------------------------
N_ASSETS  = 6
N_PERIODS = 500
PPY       = 252
TICKERS   = ["AAPL", "MSFT", "TLT", "GLD", "IWM", "SPY"]
RF        = 0.03          # annual risk-free rate

MU_ANN  = np.array([0.12, 0.10, 0.04, 0.06, 0.11, 0.09])
VOL_ANN = np.array([0.28, 0.25, 0.07, 0.15, 0.22, 0.18])

RNG = np.random.default_rng(42)

# ---------------------------------------------------------------------------
# Generate returns
# ---------------------------------------------------------------------------
def make_returns() -> np.ndarray:
    mu_d  = MU_ANN / PPY
    vol_d = VOL_ANN / np.sqrt(PPY)
    z     = RNG.standard_normal((N_PERIODS, N_ASSETS))
    return mu_d + vol_d * z          # shape (T, n)

RET = make_returns()                 # (500, 6), per-period returns

# Annualised statistics (sample, ddof=1)
ret_df  = pd.DataFrame(RET, columns=TICKERS)
mu_ann  = ret_df.mean().values * PPY
cov_ann = ret_df.cov().values * PPY

# ---------------------------------------------------------------------------
# Run Python v1 algorithms
# ---------------------------------------------------------------------------
print("Running Python v1 algorithms...")

results: dict = {
    "meta": {
        "n_assets":  N_ASSETS,
        "n_periods": N_PERIODS,
        "ppy":       PPY,
        "tickers":   TICKERS,
        "rf":        RF,
    },
    "data": {
        "returns_flat": RET.flatten().tolist(),      # row-major (T × n)
        "mu_ann":       mu_ann.tolist(),
        "cov_ann_flat": cov_ann.flatten().tolist(),  # row-major (n × n)
    },
}

# ── Markowitz efficient frontier ──────────────────────────────────────────
try:
    W, targets = trace_efficient_frontier(mu_ann, cov_ann, n_pts=25,
                                          long_only=True, lb=0.0, ub=1.0)
    best_idx, best_sharpe = pick_max_sharpe(mu_ann, cov_ann, RF, W)

    risks   = np.array([np.sqrt(max(0.0, w @ cov_ann @ w)) for w in W])
    returns = np.array([w @ mu_ann for w in W])
    sharpes = np.where(risks > 0, (returns - RF) / risks, np.nan)

    results["markowitz"] = {
        "n_portfolios": int(W.shape[0]),
        "weights_flat": W.flatten().tolist(),
        "risks":        risks.tolist(),
        "returns":      returns.tolist(),
        "sharpes":      sharpes.tolist(),
        "best_idx":     int(best_idx) if best_idx is not None else None,
        "best_sharpe":  float(best_sharpe),
        "best_weights": W[best_idx].tolist() if best_idx is not None else None,
    }
    print(f"  Markowitz: {W.shape[0]} portfolios, best Sharpe = {best_sharpe:.4f}")
except Exception as e:
    results["markowitz"] = {"error": str(e)}
    print(f"  Markowitz FAILED: {e}")

# ── HRP ───────────────────────────────────────────────────────────────────
try:
    hrp_w = hrp_weights(ret_df).values
    results["hrp"] = {
        "weights": hrp_w.tolist(),
    }
    print(f"  HRP weights: {[f'{w:.4f}' for w in hrp_w]}")
except Exception as e:
    results["hrp"] = {"error": str(e)}
    print(f"  HRP FAILED: {e}")

# ── Risk parity ───────────────────────────────────────────────────────────
try:
    rp_w  = risk_parity_weights(cov_ann, lb=0.0, ub=1.0)
    # Compute RC for verification
    Cw    = cov_ann @ rp_w
    rc    = rp_w * Cw
    rc_rel_dev = float(np.max(np.abs(rc - rc.mean())) / (rc.mean() + 1e-20))
    results["risk_parity"] = {
        "weights":     rp_w.tolist(),
        "rc_rel_dev":  rc_rel_dev,
    }
    print(f"  Risk parity: RC rel dev = {rc_rel_dev*100:.2f}%")
    print(f"               weights = {[f'{w:.4f}' for w in rp_w]}")
except Exception as e:
    results["risk_parity"] = {"error": str(e)}
    print(f"  Risk parity FAILED: {e}")

# ---------------------------------------------------------------------------
# Write JSON
# ---------------------------------------------------------------------------
out_path = REPO_ROOT / "scripts" / "compare-data.json"
with open(out_path, "w") as f:
    json.dump(results, f, indent=2)

print(f"\nWrote {out_path}")
print("Now run: node scripts/compare-with-v1.mjs")
