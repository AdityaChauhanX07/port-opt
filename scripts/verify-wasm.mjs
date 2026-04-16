/**
 * scripts/verify-wasm.mjs
 *
 * Sanity-checks every WASM-exported function against a known 6-asset,
 * 500-period synthetic return matrix.  Prints PASS / FAIL / SKIP for each.
 *
 * Usage:
 *   node scripts/verify-wasm.mjs
 *
 * Requires: WASM pkg already built at apps/web/src/lib/wasm/pkg/
 *   Run `bash scripts/build-wasm.sh` first.
 */

import { readFileSync } from 'fs';
import { fileURLToPath, pathToFileURL } from 'url';
import { dirname, join }  from 'path';

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_DIR   = join(__dirname, '..', 'apps', 'web', 'src', 'lib', 'wasm', 'pkg');

const GREEN  = '\x1b[32m';
const RED    = '\x1b[31m';
const YELLOW = '\x1b[33m';
const RESET  = '\x1b[0m';

let passed = 0, failed = 0, skipped = 0;

function pass(name) {
  console.log(`  ${GREEN}PASS${RESET}  ${name}`);
  passed++;
}
function fail(name, reason) {
  console.log(`  ${RED}FAIL${RESET}  ${name}: ${reason}`);
  failed++;
}
function skip(name, reason) {
  console.log(`  ${YELLOW}SKIP${RESET}  ${name}: ${reason}`);
  skipped++;
}

// ---------------------------------------------------------------------------
// Tiny seeded PRNG (Mulberry32) + Box-Muller normal sampler
// ---------------------------------------------------------------------------

function mulberry32(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t ^ (t + Math.imul(t ^ (t >>> 7), 61 | t))) >>> 0;
    return (t ^ (t >>> 14)) / 4294967296;
  };
}

function makeNormal(rand) {
  let spare = null;
  return () => {
    if (spare !== null) { const v = spare; spare = null; return v; }
    let u, v, s;
    do { u = rand() * 2 - 1; v = rand() * 2 - 1; s = u*u + v*v; } while (s >= 1 || s === 0);
    const m = Math.sqrt(-2 * Math.log(s) / s);
    spare = v * m;
    return u * m;
  };
}

// ---------------------------------------------------------------------------
// Generate synthetic return matrix
// Seeded reproducible: 6 assets × 500 periods, row-major
// ---------------------------------------------------------------------------

const N_ASSETS  = 6;
const N_PERIODS = 500;
const PPY       = 252;
const TICKERS   = ['AAPL', 'MSFT', 'TLT', 'GLD', 'IWM', 'SPY'];

// Annual parameters (decimal)
const MU_ANN  = [0.12, 0.10, 0.04, 0.06, 0.11, 0.09];
const VOL_ANN = [0.28, 0.25, 0.07, 0.15, 0.22, 0.18];

function makeReturns(seed = 42) {
  const rand   = mulberry32(seed);
  const normal = makeNormal(rand);
  const ret    = new Float64Array(N_PERIODS * N_ASSETS);
  for (let t = 0; t < N_PERIODS; t++) {
    for (let a = 0; a < N_ASSETS; a++) {
      const mu_d  = MU_ANN[a]  / PPY;
      const vol_d = VOL_ANN[a] / Math.sqrt(PPY);
      ret[t * N_ASSETS + a] = mu_d + vol_d * normal();
    }
  }
  return ret;
}

/** Sample covariance (ddof=1, per-period), returned as Float64Array row-major */
function sampleCov(ret) {
  const T = N_PERIODS, n = N_ASSETS;
  const means = new Float64Array(n);
  for (let a = 0; a < n; a++) {
    for (let t = 0; t < T; t++) means[a] += ret[t * n + a];
    means[a] /= T;
  }
  const cov = new Float64Array(n * n);
  for (let a = 0; a < n; a++) {
    for (let b = a; b < n; b++) {
      let s = 0;
      for (let t = 0; t < T; t++)
        s += (ret[t * n + a] - means[a]) * (ret[t * n + b] - means[b]);
      cov[a * n + b] = cov[b * n + a] = s / (T - 1);
    }
  }
  return cov;
}

// ---------------------------------------------------------------------------
// Load WASM
// ---------------------------------------------------------------------------

console.log('\nLoading WASM module...');
const wasmBuf   = readFileSync(join(PKG_DIR, 'engine_wasm_bg.wasm'));
const wasmBinary = wasmBuf.buffer.slice(wasmBuf.byteOffset, wasmBuf.byteOffset + wasmBuf.byteLength);
const moduleUrl  = pathToFileURL(join(PKG_DIR, 'engine_wasm.js')).href;

let engine;
try {
  engine = await import(moduleUrl);
  await engine.default(wasmBinary);
  console.log('WASM loaded OK\n');
} catch (e) {
  console.error(`${RED}Cannot load WASM: ${e.message}${RESET}`);
  console.error('Run `bash scripts/build-wasm.sh` first.');
  process.exit(1);
}

const {
  solve_frontier, solve_hrp, solve_risk_parity,
  solve_cvar, solve_robust,
  run_monte_carlo, run_backtest_static, run_backtest_walkforward,
  compute_risk_metrics, compute_correlation, bootstrap_sharpe,
} = engine;

// ---------------------------------------------------------------------------
// Shared data
// ---------------------------------------------------------------------------

const RET = makeReturns(42);
const COV = sampleCov(RET);

const EPS   = 1e-6;
const allFinite = (arr) => arr.every(Number.isFinite);
const sumClose = (arr, target = 1, tol = EPS) => Math.abs(arr.reduce((a, b) => a + b, 0) - target) < tol;
const allGe = (arr, lb) => arr.every(v => v >= lb - EPS);

function parseOrFail(json, name) {
  const r = JSON.parse(json);
  if (r.error) throw new Error(r.error);
  return r;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

console.log('─'.repeat(60));
console.log('  solve_frontier');
console.log('─'.repeat(60));
{
  let r;
  try {
    r = parseOrFail(
      solve_frontier(RET, N_PERIODS, N_ASSETS, 25, true, 0, 1, 0.03, PPY),
      'solve_frontier'
    );
  } catch (e) { fail('solve_frontier', e.message); r = null; }

  if (r) {
    const k = r.n_portfolios, n = r.n_assets;

    // bestIdx >= 0
    typeof r.best_idx === 'number' && r.best_idx >= 0
      ? pass('bestIdx >= 0')
      : fail('bestIdx >= 0', `got ${r.best_idx}`);

    // all weights row-sums ≈ 1
    let wOk = true, wMsg = '';
    for (let i = 0; i < k; i++) {
      const rowSum = r.weights.slice(i * n, (i + 1) * n).reduce((a, b) => a + b, 0);
      if (Math.abs(rowSum - 1) > EPS) { wOk = false; wMsg = `row ${i} sums to ${rowSum.toFixed(8)}`; break; }
    }
    wOk ? pass('weights row-sums ≈ 1') : fail('weights row-sums ≈ 1', wMsg);

    // all sharpes finite
    allFinite(r.sharpes)
      ? pass('all sharpes finite')
      : fail('all sharpes finite', `found ${r.sharpes.filter(x => !Number.isFinite(x)).length} non-finite`);

    // risks and returns both positive/increasing
    const monRet = r.returns.every((v, i) => i === 0 || v >= r.returns[i - 1] - 1e-4);
    monRet
      ? pass('frontier returns monotone')
      : fail('frontier returns monotone', 'non-monotone returns in frontier');

    // n_portfolios > 0
    k > 0 ? pass('n_portfolios > 0') : fail('n_portfolios > 0', `got ${k}`);
  }
}

console.log('\n' + '─'.repeat(60));
console.log('  solve_hrp');
console.log('─'.repeat(60));
{
  let r;
  try {
    r = parseOrFail(
      solve_hrp(RET, N_PERIODS, N_ASSETS, JSON.stringify(TICKERS)),
      'solve_hrp'
    );
  } catch (e) { fail('solve_hrp', e.message); r = null; }

  if (r) {
    // weights sum to 1
    sumClose(r.weights)
      ? pass('weights sum ≈ 1')
      : fail('weights sum ≈ 1', `sum = ${r.weights.reduce((a, b) => a + b, 0).toFixed(8)}`);

    // all non-negative
    allGe(r.weights, 0)
      ? pass('all weights >= 0')
      : fail('all weights >= 0', `min = ${Math.min(...r.weights).toFixed(8)}`);

    // all finite
    allFinite(r.weights)
      ? pass('all weights finite')
      : fail('all weights finite', 'NaN or Inf found');
  }
}

console.log('\n' + '─'.repeat(60));
console.log('  solve_risk_parity');
console.log('─'.repeat(60));
{
  let r;
  try {
    r = parseOrFail(
      solve_risk_parity(COV, N_ASSETS, 0, 1),
      'solve_risk_parity'
    );
  } catch (e) { fail('solve_risk_parity', e.message); r = null; }

  if (r) {
    sumClose(r.weights)
      ? pass('weights sum ≈ 1')
      : fail('weights sum ≈ 1', `sum = ${r.weights.reduce((a, b) => a + b, 0).toFixed(8)}`);

    allGe(r.weights, 0)
      ? pass('all weights >= 0')
      : fail('all weights >= 0', `min = ${Math.min(...r.weights).toFixed(8)}`);

    // Check risk contributions are roughly equal
    // RC_i = w_i * (Cov @ w)_i  →  all should be ≈ portfolio_variance / n
    const w = r.weights;
    const Cw = new Array(N_ASSETS).fill(0);
    for (let a = 0; a < N_ASSETS; a++)
      for (let b = 0; b < N_ASSETS; b++)
        Cw[a] += COV[a * N_ASSETS + b] * w[b];
    const rc = w.map((wi, i) => wi * Cw[i]);
    const rcMean = rc.reduce((a, b) => a + b, 0) / N_ASSETS;
    const rcMaxDev = Math.max(...rc.map(v => Math.abs(v - rcMean)));
    const rcRelDev = rcMaxDev / (rcMean + 1e-20);

    rcRelDev < 0.1
      ? pass(`risk contributions approx equal (max rel dev = ${(rcRelDev * 100).toFixed(2)}%)`)
      : fail('risk contributions approx equal', `max rel dev = ${(rcRelDev * 100).toFixed(2)}%`);
  }
}

console.log('\n' + '─'.repeat(60));
console.log('  solve_cvar  (WASM stub — expected to be unavailable)');
console.log('─'.repeat(60));
{
  const json = solve_cvar(RET, N_PERIODS, N_ASSETS, 0.95, true, 0, 1);
  const r    = JSON.parse(json);
  if (r.error && r.error.toLowerCase().includes('not available')) {
    skip('solve_cvar', `WASM stub: "${r.error}"`);
  } else if (r.weights) {
    // If it somehow works (unlikely in WASM), validate
    sumClose(r.weights) ? pass('solve_cvar weights sum ≈ 1') : fail('solve_cvar weights sum ≈ 1', '');
    allGe(r.weights, 0) ? pass('solve_cvar all >= 0')        : fail('solve_cvar all >= 0', '');
  } else {
    fail('solve_cvar', `unexpected response: ${json.slice(0, 80)}`);
  }
}

console.log('\n' + '─'.repeat(60));
console.log('  solve_robust  (WASM stub — expected to be unavailable)');
console.log('─'.repeat(60));
{
  const jsonG0  = solve_robust(RET, N_PERIODS, N_ASSETS, 0,  true, 0, 1, PPY);
  const jsonG10 = solve_robust(RET, N_PERIODS, N_ASSETS, 10, true, 0, 1, PPY);
  const r0  = JSON.parse(jsonG0);
  const r10 = JSON.parse(jsonG10);
  if (r0.error && r0.error.toLowerCase().includes('not available')) {
    skip('solve_robust γ=0', `WASM stub: "${r0.error}"`);
    skip('solve_robust γ=10 has lower return than γ=0', 'WASM stub');
  } else if (r0.weights && r10.weights) {
    // Validate feasibility
    sumClose(r0.weights) && allGe(r0.weights, 0)
      ? pass('solve_robust γ=0 feasible')
      : fail('solve_robust γ=0 feasible', '');
    // γ=10 should push toward min-variance (lower expected return)
    const mu_ann = new Array(N_ASSETS).fill(0);
    const means  = new Array(N_ASSETS).fill(0);
    for (let a = 0; a < N_ASSETS; a++) {
      for (let t = 0; t < N_PERIODS; t++) means[a] += RET[t * N_ASSETS + a];
      means[a] /= N_PERIODS;
      mu_ann[a] = means[a] * PPY;
    }
    const ret0  = r0.weights.reduce((s, wi, i) => s + wi * mu_ann[i], 0);
    const ret10 = r10.weights.reduce((s, wi, i) => s + wi * mu_ann[i], 0);
    ret10 <= ret0 + 1e-4
      ? pass(`solve_robust γ=10 return (${ret10.toFixed(4)}) ≤ γ=0 (${ret0.toFixed(4)})`)
      : fail('solve_robust γ=10 has lower return', `${ret10.toFixed(4)} > ${ret0.toFixed(4)}`);
  } else {
    fail('solve_robust', `unexpected: ${jsonG0.slice(0, 80)}`);
  }
}

console.log('\n' + '─'.repeat(60));
console.log('  run_monte_carlo');
console.log('─'.repeat(60));
{
  let r;
  const params = JSON.stringify({
    mu_annual: 0.08, vol_annual: 0.15, start_value: 1.0,
    years: 5.0, ppy: 252, n_paths: 2000, seed: 42,
  });
  try {
    r = parseOrFail(run_monte_carlo(params), 'run_monte_carlo');
  } catch (e) { fail('run_monte_carlo', e.message); r = null; }

  if (r) {
    const fields = ['mean', 'median', 'p5', 'p25', 'p75', 'p95', 'std', 'prob_loss'];
    const allF = fields.every(f => typeof r[f] === 'number' && Number.isFinite(r[f]));
    allF ? pass('all quantile fields present and finite') : fail('quantile fields', 'some null or non-finite');

    // p5 < median < p95
    r.p5 < r.median && r.median < r.p95
      ? pass(`quantile ordering p5(${r.p5.toFixed(3)}) < median(${r.median.toFixed(3)}) < p95(${r.p95.toFixed(3)})`)
      : fail('quantile ordering p5 < median < p95', `p5=${r.p5} median=${r.median} p95=${r.p95}`);

    // prob_loss in [0, 1]
    r.prob_loss >= 0 && r.prob_loss <= 1
      ? pass(`prob_loss in [0, 1] (${r.prob_loss.toFixed(4)})`)
      : fail('prob_loss in [0, 1]', `got ${r.prob_loss}`);

    // 5-year GBM at 8% mu → mean terminal roughly exp(0.08*5) ≈ 1.49
    const expected = Math.exp(0.08 * 5);
    Math.abs(r.mean - expected) < 0.2
      ? pass(`mean terminal ≈ exp(0.08×5) = ${expected.toFixed(3)} (got ${r.mean.toFixed(3)})`)
      : fail('mean terminal value', `expected ≈ ${expected.toFixed(3)}, got ${r.mean.toFixed(3)}`);
  }
}

console.log('\n' + '─'.repeat(60));
console.log('  run_backtest_walkforward');
console.log('─'.repeat(60));
{
  let r;
  const cfg = JSON.stringify({ window: 60, step: 21, long_only: true, ppy: PPY });
  try {
    r = parseOrFail(
      run_backtest_walkforward(RET, N_PERIODS, N_ASSETS, cfg),
      'run_backtest_walkforward'
    );
  } catch (e) { fail('run_backtest_walkforward', e.message); r = null; }

  if (r) {
    // equity curve is non-empty and positive
    const eq = r.portfolio_equity;
    eq.length > 0
      ? pass(`equity curve length = ${eq.length}`)
      : fail('equity curve non-empty', 'empty');

    eq.every(v => v > 0)
      ? pass('equity curve all positive')
      : fail('equity curve all positive', `min = ${Math.min(...eq).toFixed(6)}`);

    // first equity value = 1 * (1 + ret[0]), so it will be very close to 1 for daily returns
    // equity_curve does NOT prepend the start value — eq[0] = start * (1 + ret[0])
    Math.abs(eq[0] - 1) < 0.1
      ? pass(`equity starts near 1 (eq[0] = ${eq[0].toFixed(6)})`)
      : fail('equity starts near 1', `eq[0] = ${eq[0]}`);

    // weight history is non-empty
    r.weights_history.length > 0
      ? pass(`weight history length = ${r.weights_history.length} (${r.weights_shape[0]} rebalances × ${r.weights_shape[1]} assets)`)
      : fail('weight history non-empty', 'empty');

    // all rebalance weight rows sum to ≈ 1
    const [nReb, nA] = r.weights_shape;
    let wOk = true, wMsg = '';
    for (let i = 0; i < nReb; i++) {
      const row = r.weights_history.slice(i * nA, (i + 1) * nA);
      const s = row.reduce((a, b) => a + b, 0);
      if (Math.abs(s - 1) > 1e-4) { wOk = false; wMsg = `row ${i} sum = ${s.toFixed(8)}`; break; }
    }
    wOk ? pass('all rebalance weight rows sum ≈ 1') : fail('weight row sums', wMsg);

    // rebalance indices are in range
    const maxIdx = Math.max(...r.rebalance_indices);
    maxIdx < N_PERIODS
      ? pass(`rebalance indices in range (max = ${maxIdx})`)
      : fail('rebalance indices in range', `max = ${maxIdx} >= N_PERIODS = ${N_PERIODS}`);
  }
}

console.log('\n' + '─'.repeat(60));
console.log('  compute_correlation');
console.log('─'.repeat(60));
{
  let r;
  try {
    r = parseOrFail(
      compute_correlation(RET, N_PERIODS, N_ASSETS),
      'compute_correlation'
    );
  } catch (e) { fail('compute_correlation', e.message); r = null; }

  if (r) {
    // shape is n×n
    const [nr, nc] = r.shape;
    nr === N_ASSETS && nc === N_ASSETS
      ? pass(`shape = [${nr}, ${nc}]`)
      : fail('shape', `expected [${N_ASSETS}, ${N_ASSETS}], got [${nr}, ${nc}]`);

    // diagonal = 1
    let diagOk = true;
    for (let i = 0; i < N_ASSETS; i++) {
      if (Math.abs(r.corr[i * N_ASSETS + i] - 1) > EPS) { diagOk = false; break; }
    }
    diagOk ? pass('diagonal = 1') : fail('diagonal = 1', 'diagonal elements != 1');

    // all off-diag in [-1, 1]
    const offDiagOk = r.corr.every((v, idx) => {
      const a = Math.floor(idx / N_ASSETS), b = idx % N_ASSETS;
      return a === b || (v >= -1 - EPS && v <= 1 + EPS);
    });
    offDiagOk ? pass('all off-diagonal in [-1, 1]') : fail('off-diagonal in [-1, 1]', 'some out of range');
  }
}

console.log('\n' + '─'.repeat(60));
console.log('  bootstrap_sharpe');
console.log('─'.repeat(60));
{
  // Build a simple 1-asset portfolio return series
  const portRet = new Float64Array(N_PERIODS);
  for (let t = 0; t < N_PERIODS; t++) portRet[t] = RET[t * N_ASSETS + 0]; // AAPL

  let r;
  try {
    r = parseOrFail(
      bootstrap_sharpe(portRet, 0.03 / PPY, 1000, 10, 0.95, BigInt(42)),
      'bootstrap_sharpe'
    );
  } catch (e) { fail('bootstrap_sharpe', e.message); r = null; }

  if (r) {
    [r.mean, r.ci_lower, r.ci_upper].every(Number.isFinite)
      ? pass('mean and CI bounds are finite')
      : fail('mean and CI bounds finite', `mean=${r.mean} lo=${r.ci_lower} hi=${r.ci_upper}`);

    r.ci_lower <= r.mean && r.mean <= r.ci_upper
      ? pass(`CI ordering ci_lower ≤ mean ≤ ci_upper (${r.ci_lower.toFixed(3)}, ${r.mean.toFixed(3)}, ${r.ci_upper.toFixed(3)})`)
      : fail('CI ordering', `${r.ci_lower.toFixed(3)} ≤ ${r.mean.toFixed(3)} ≤ ${r.ci_upper.toFixed(3)}`);

    r.n_samples >= 1000
      ? pass(`n_samples = ${r.n_samples}`)
      : fail('n_samples >= 1000', `got ${r.n_samples}`);
  }
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log('\n' + '═'.repeat(60));
console.log(`  ${GREEN}PASS${RESET}: ${passed}   ${RED}FAIL${RESET}: ${failed}   ${YELLOW}SKIP${RESET}: ${skipped}`);
console.log('═'.repeat(60) + '\n');

if (failed > 0) process.exit(1);
