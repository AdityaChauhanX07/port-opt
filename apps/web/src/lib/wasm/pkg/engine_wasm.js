/* @ts-self-types="./engine_wasm.d.ts" */

//#region exports

/**
 * Block-bootstrap Sharpe ratio confidence interval.
 *
 * Returns JSON: `{"mean":...,"ci_lower":...,"ci_upper":...,"n_samples":...}`
 * @param {Float64Array} returns_flat
 * @param {number} rf_per_period
 * @param {number} n_boot
 * @param {number} block_size
 * @param {number} ci
 * @param {bigint} seed
 * @returns {string}
 */
export function bootstrap_sharpe(returns_flat, rf_per_period, n_boot, block_size, ci, seed) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passArrayF64ToWasm0(returns_flat, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        _assertNum(n_boot);
        _assertNum(block_size);
        _assertBigInt(seed);
        const ret = wasm.bootstrap_sharpe(ptr0, len0, rf_per_period, n_boot, block_size, ci, seed);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}

/**
 * Compute the Pearson correlation matrix from a return matrix.
 *
 * Returns JSON: `{"corr":[...],"shape":[n_assets,n_assets]}`
 * where `corr` is a flat row-major array.
 * @param {Float64Array} returns_flat
 * @param {number} n_rows
 * @param {number} n_cols
 * @returns {string}
 */
export function compute_correlation(returns_flat, n_rows, n_cols) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passArrayF64ToWasm0(returns_flat, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        _assertNum(n_rows);
        _assertNum(n_cols);
        const ret = wasm.compute_correlation(ptr0, len0, n_rows, n_cols);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}

/**
 * Compute annualised performance metrics from an equity curve.
 *
 * Returns JSON:
 * `{"cagr":..., "ann_return":..., "ann_vol":..., "max_dd":..., "var_95":..., "cvar_95":...}`
 * @param {Float64Array} equity_flat
 * @param {number} rf
 * @param {number} ppy
 * @returns {string}
 */
export function compute_risk_metrics(equity_flat, rf, ppy) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passArrayF64ToWasm0(equity_flat, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        _assertNum(ppy);
        const ret = wasm.compute_risk_metrics(ptr0, len0, rf, ppy);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}

/**
 * Compute rolling Sharpe and Sortino ratios from a return series.
 *
 * Returns JSON: `{"rolling_sharpe":[...],"rolling_sortino":[...]}`
 * (`null` for windows that cannot be computed).
 * @param {Float64Array} returns_flat
 * @param {number} rf_per_period
 * @param {number} window
 * @returns {string}
 */
export function compute_rolling_metrics(returns_flat, rf_per_period, window) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passArrayF64ToWasm0(returns_flat, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        _assertNum(window);
        const ret = wasm.compute_rolling_metrics(ptr0, len0, rf_per_period, window);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}

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
 * @param {Float64Array} portfolio_returns
 * @param {Float64Array} factor_returns_flat
 * @param {number} n_periods
 * @param {number} n_factors
 * @param {string} factor_names_json
 * @param {number} ppy
 * @returns {string}
 */
export function decompose_factor_risk(portfolio_returns, factor_returns_flat, n_periods, n_factors, factor_names_json, ppy) {
    let deferred4_0;
    let deferred4_1;
    try {
        const ptr0 = passArrayF64ToWasm0(portfolio_returns, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArrayF64ToWasm0(factor_returns_flat, wasm.__wbindgen_malloc);
        const len1 = WASM_VECTOR_LEN;
        _assertNum(n_periods);
        _assertNum(n_factors);
        const ptr2 = passStringToWasm0(factor_names_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len2 = WASM_VECTOR_LEN;
        _assertNum(ppy);
        const ret = wasm.decompose_factor_risk(ptr0, len0, ptr1, len1, n_periods, n_factors, ptr2, len2, ppy);
        deferred4_0 = ret[0];
        deferred4_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred4_0, deferred4_1, 1);
    }
}

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
 * @param {Float64Array} returns_flat
 * @param {number} n_regimes
 * @param {number} max_iter
 * @param {bigint} seed
 * @returns {string}
 */
export function detect_regimes_wasm(returns_flat, n_regimes, max_iter, seed) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passArrayF64ToWasm0(returns_flat, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        _assertNum(n_regimes);
        _assertNum(max_iter);
        _assertBigInt(seed);
        const ret = wasm.detect_regimes_wasm(ptr0, len0, n_regimes, max_iter, seed);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}

/**
 * Initialise the WASM module.  Call once from JS before any other function.
 * Sets up `console.error` panic hook so panics surface in the browser console.
 */
export function init() {
    wasm.init();
}

/**
 * Run a static (buy-and-hold) backtest.
 *
 * `weights_flat`: n-element weight vector.
 *
 * Returns JSON:
 * `{"portfolio_equity":[...],"portfolio_returns":[...],"portfolio_dd":[...],
 *   "ew_equity":[...]|null,"ew_dd":[...]|null}`
 * @param {Float64Array} returns_flat
 * @param {number} n_rows
 * @param {number} n_cols
 * @param {Float64Array} weights_flat
 * @param {boolean} include_ew
 * @returns {string}
 */
export function run_backtest_static(returns_flat, n_rows, n_cols, weights_flat, include_ew) {
    let deferred3_0;
    let deferred3_1;
    try {
        const ptr0 = passArrayF64ToWasm0(returns_flat, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        _assertNum(n_rows);
        _assertNum(n_cols);
        const ptr1 = passArrayF64ToWasm0(weights_flat, wasm.__wbindgen_malloc);
        const len1 = WASM_VECTOR_LEN;
        _assertBoolean(include_ew);
        const ret = wasm.run_backtest_static(ptr0, len0, n_rows, n_cols, ptr1, len1, include_ew);
        deferred3_0 = ret[0];
        deferred3_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
    }
}

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
 * @param {Float64Array} returns_flat
 * @param {number} n_rows
 * @param {number} n_cols
 * @param {string} config_json
 * @returns {string}
 */
export function run_backtest_walkforward(returns_flat, n_rows, n_cols, config_json) {
    let deferred3_0;
    let deferred3_1;
    try {
        const ptr0 = passArrayF64ToWasm0(returns_flat, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        _assertNum(n_rows);
        _assertNum(n_cols);
        const ptr1 = passStringToWasm0(config_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.run_backtest_walkforward(ptr0, len0, n_rows, n_cols, ptr1, len1);
        deferred3_0 = ret[0];
        deferred3_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
    }
}

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
 * @param {string} params_json
 * @returns {string}
 */
export function run_monte_carlo(params_json) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(params_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.run_monte_carlo(ptr0, len0);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}

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
 * @param {Float64Array} cov_flat
 * @param {number} n_assets
 * @param {Float64Array} market_weights_flat
 * @param {number} rf
 * @param {number} market_return
 * @param {Float64Array} views_packed
 * @param {number} tau
 * @param {boolean} long_only
 * @param {number} lb
 * @param {number} ub
 * @param {number} n_pts
 * @returns {string}
 */
export function solve_black_litterman(cov_flat, n_assets, market_weights_flat, rf, market_return, views_packed, tau, long_only, lb, ub, n_pts) {
    let deferred4_0;
    let deferred4_1;
    try {
        const ptr0 = passArrayF64ToWasm0(cov_flat, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        _assertNum(n_assets);
        const ptr1 = passArrayF64ToWasm0(market_weights_flat, wasm.__wbindgen_malloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passArrayF64ToWasm0(views_packed, wasm.__wbindgen_malloc);
        const len2 = WASM_VECTOR_LEN;
        _assertBoolean(long_only);
        _assertNum(n_pts);
        const ret = wasm.solve_black_litterman(ptr0, len0, n_assets, ptr1, len1, rf, market_return, ptr2, len2, tau, long_only, lb, ub, n_pts);
        deferred4_0 = ret[0];
        deferred4_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred4_0, deferred4_1, 1);
    }
}

/**
 * Minimise CVaR at confidence `alpha`.
 *
 * Native: uses Clarabel LP solver.
 * WASM:   uses projected subgradient descent (no Clarabel dependency).
 *
 * Returns JSON: `{"weights":[...]}` or `{"error":"..."}`.
 * @param {Float64Array} returns_flat
 * @param {number} n_rows
 * @param {number} n_cols
 * @param {number} alpha
 * @param {boolean} long_only
 * @param {number} lb
 * @param {number} ub
 * @returns {string}
 */
export function solve_cvar(returns_flat, n_rows, n_cols, alpha, long_only, lb, ub) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passArrayF64ToWasm0(returns_flat, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        _assertNum(n_rows);
        _assertNum(n_cols);
        _assertBoolean(long_only);
        const ret = wasm.solve_cvar(ptr0, len0, n_rows, n_cols, alpha, long_only, lb, ub);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}

/**
 * Trace the efficient frontier and return portfolios with their statistics.
 *
 * `returns_flat`: T×n return matrix, row-major.
 *
 * Returns JSON:
 * `{"weights":[...],"risks":[...],"returns":[...],"sharpes":[...],"best_idx":int|null}`
 *
 * `weights` is a flat row-major array of shape `(n_feasible × n_assets)`.
 * @param {Float64Array} returns_flat
 * @param {number} n_rows
 * @param {number} n_cols
 * @param {number} n_pts
 * @param {boolean} long_only
 * @param {number} lb
 * @param {number} ub
 * @param {number} rf
 * @param {number} ppy
 * @returns {string}
 */
export function solve_frontier(returns_flat, n_rows, n_cols, n_pts, long_only, lb, ub, rf, ppy) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passArrayF64ToWasm0(returns_flat, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        _assertNum(n_rows);
        _assertNum(n_cols);
        _assertNum(n_pts);
        _assertBoolean(long_only);
        _assertNum(ppy);
        const ret = wasm.solve_frontier(ptr0, len0, n_rows, n_cols, n_pts, long_only, lb, ub, rf, ppy);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}

/**
 * Compute HRP weights from a return matrix.
 *
 * `tickers_json`: JSON array of strings, e.g. `["SPY","BND","GLD"]`.
 *
 * Returns JSON: `{"weights":[...],"tickers":[...]}`.
 * @param {Float64Array} returns_flat
 * @param {number} n_rows
 * @param {number} n_cols
 * @param {string} tickers_json
 * @returns {string}
 */
export function solve_hrp(returns_flat, n_rows, n_cols, tickers_json) {
    let deferred3_0;
    let deferred3_1;
    try {
        const ptr0 = passArrayF64ToWasm0(returns_flat, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        _assertNum(n_rows);
        _assertNum(n_cols);
        const ptr1 = passStringToWasm0(tickers_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.solve_hrp(ptr0, len0, n_rows, n_cols, ptr1, len1);
        deferred3_0 = ret[0];
        deferred3_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
    }
}

/**
 * Compute Equal Risk Contribution (risk-parity) weights.
 *
 * `cov_flat`: n×n covariance matrix, row-major.
 *
 * Returns JSON: `{"weights":[...]}`.
 * @param {Float64Array} cov_flat
 * @param {number} n
 * @param {number} lb
 * @param {number} ub
 * @returns {string}
 */
export function solve_risk_parity(cov_flat, n, lb, ub) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passArrayF64ToWasm0(cov_flat, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        _assertNum(n);
        const ret = wasm.solve_risk_parity(ptr0, len0, n, lb, ub);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}

/**
 * Robust mean–variance optimisation with ellipsoidal return uncertainty.
 *
 * Native: uses Clarabel SOCP solver.
 * WASM:   uses projected gradient descent (no Clarabel dependency).
 *
 * Returns JSON: `{"weights":[...]}` or `{"error":"..."}`.
 * @param {Float64Array} returns_flat
 * @param {number} n_rows
 * @param {number} n_cols
 * @param {number} gamma
 * @param {boolean} long_only
 * @param {number} lb
 * @param {number} ub
 * @param {number} ppy
 * @returns {string}
 */
export function solve_robust(returns_flat, n_rows, n_cols, gamma, long_only, lb, ub, ppy) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passArrayF64ToWasm0(returns_flat, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        _assertNum(n_rows);
        _assertNum(n_cols);
        _assertBoolean(long_only);
        _assertNum(ppy);
        const ret = wasm.solve_robust(ptr0, len0, n_rows, n_cols, gamma, long_only, lb, ub, ppy);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}

//#endregion

//#region wasm imports
function __wbg_get_imports() {
    const import0 = {
        __proto__: null,
        __wbg___wbindgen_throw_6b64449b9b9ed33c: function(arg0, arg1) {
            throw new Error(getStringFromWasm0(arg0, arg1));
        },
        __wbg_error_a6fa202b58aa1cd3: function() { return logError(function (arg0, arg1) {
            let deferred0_0;
            let deferred0_1;
            try {
                deferred0_0 = arg0;
                deferred0_1 = arg1;
                console.error(getStringFromWasm0(arg0, arg1));
            } finally {
                wasm.__wbindgen_free(deferred0_0, deferred0_1, 1);
            }
        }, arguments); },
        __wbg_new_227d7c05414eb861: function() { return logError(function () {
            const ret = new Error();
            return ret;
        }, arguments); },
        __wbg_stack_3b0d974bbf31e44f: function() { return logError(function (arg0, arg1) {
            const ret = arg1.stack;
            const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
        }, arguments); },
        __wbindgen_init_externref_table: function() {
            const table = wasm.__wbindgen_externrefs;
            const offset = table.grow(4);
            table.set(0, undefined);
            table.set(offset + 0, undefined);
            table.set(offset + 1, null);
            table.set(offset + 2, true);
            table.set(offset + 3, false);
        },
    };
    return {
        __proto__: null,
        "./engine_wasm_bg.js": import0,
    };
}


//#endregion

//#region intrinsics
function _assertBigInt(n) {
    if (typeof(n) !== 'bigint') throw new Error(`expected a bigint argument, found ${typeof(n)}`);
}

function _assertBoolean(n) {
    if (typeof(n) !== 'boolean') {
        throw new Error(`expected a boolean argument, found ${typeof(n)}`);
    }
}

function _assertNum(n) {
    if (typeof(n) !== 'number') throw new Error(`expected a number argument, found ${typeof(n)}`);
}

let cachedDataViewMemory0 = null;
function getDataViewMemory0() {
    if (cachedDataViewMemory0 === null || cachedDataViewMemory0.buffer.detached === true || (cachedDataViewMemory0.buffer.detached === undefined && cachedDataViewMemory0.buffer !== wasm.memory.buffer)) {
        cachedDataViewMemory0 = new DataView(wasm.memory.buffer);
    }
    return cachedDataViewMemory0;
}

let cachedFloat64ArrayMemory0 = null;
function getFloat64ArrayMemory0() {
    if (cachedFloat64ArrayMemory0 === null || cachedFloat64ArrayMemory0.byteLength === 0) {
        cachedFloat64ArrayMemory0 = new Float64Array(wasm.memory.buffer);
    }
    return cachedFloat64ArrayMemory0;
}

function getStringFromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return decodeText(ptr, len);
}

let cachedUint8ArrayMemory0 = null;
function getUint8ArrayMemory0() {
    if (cachedUint8ArrayMemory0 === null || cachedUint8ArrayMemory0.byteLength === 0) {
        cachedUint8ArrayMemory0 = new Uint8Array(wasm.memory.buffer);
    }
    return cachedUint8ArrayMemory0;
}

function logError(f, args) {
    try {
        return f.apply(this, args);
    } catch (e) {
        let error = (function () {
            try {
                return e instanceof Error ? `${e.message}\n\nStack:\n${e.stack}` : e.toString();
            } catch(_) {
                return "<failed to stringify thrown value>";
            }
        }());
        console.error("wasm-bindgen: imported JS function that was not marked as `catch` threw an error:", error);
        throw e;
    }
}

function passArrayF64ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 8, 8) >>> 0;
    getFloat64ArrayMemory0().set(arg, ptr / 8);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

function passStringToWasm0(arg, malloc, realloc) {
    if (typeof(arg) !== 'string') throw new Error(`expected a string argument, found ${typeof(arg)}`);
    if (realloc === undefined) {
        const buf = cachedTextEncoder.encode(arg);
        const ptr = malloc(buf.length, 1) >>> 0;
        getUint8ArrayMemory0().subarray(ptr, ptr + buf.length).set(buf);
        WASM_VECTOR_LEN = buf.length;
        return ptr;
    }

    let len = arg.length;
    let ptr = malloc(len, 1) >>> 0;

    const mem = getUint8ArrayMemory0();

    let offset = 0;

    for (; offset < len; offset++) {
        const code = arg.charCodeAt(offset);
        if (code > 0x7F) break;
        mem[ptr + offset] = code;
    }
    if (offset !== len) {
        if (offset !== 0) {
            arg = arg.slice(offset);
        }
        ptr = realloc(ptr, len, len = offset + arg.length * 3, 1) >>> 0;
        const view = getUint8ArrayMemory0().subarray(ptr + offset, ptr + len);
        const ret = cachedTextEncoder.encodeInto(arg, view);
        if (ret.read !== arg.length) throw new Error('failed to pass whole string');
        offset += ret.written;
        ptr = realloc(ptr, len, offset, 1) >>> 0;
    }

    WASM_VECTOR_LEN = offset;
    return ptr;
}

let cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
cachedTextDecoder.decode();
const MAX_SAFARI_DECODE_BYTES = 2146435072;
let numBytesDecoded = 0;
function decodeText(ptr, len) {
    numBytesDecoded += len;
    if (numBytesDecoded >= MAX_SAFARI_DECODE_BYTES) {
        cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
        cachedTextDecoder.decode();
        numBytesDecoded = len;
    }
    return cachedTextDecoder.decode(getUint8ArrayMemory0().subarray(ptr, ptr + len));
}

const cachedTextEncoder = new TextEncoder();

if (!('encodeInto' in cachedTextEncoder)) {
    cachedTextEncoder.encodeInto = function (arg, view) {
        const buf = cachedTextEncoder.encode(arg);
        view.set(buf);
        return {
            read: arg.length,
            written: buf.length
        };
    };
}

let WASM_VECTOR_LEN = 0;


//#endregion

//#region wasm loading
let wasmModule, wasm;
function __wbg_finalize_init(instance, module) {
    wasm = instance.exports;
    wasmModule = module;
    cachedDataViewMemory0 = null;
    cachedFloat64ArrayMemory0 = null;
    cachedUint8ArrayMemory0 = null;
    wasm.__wbindgen_start();
    return wasm;
}

async function __wbg_load(module, imports) {
    if (typeof Response === 'function' && module instanceof Response) {
        if (typeof WebAssembly.instantiateStreaming === 'function') {
            try {
                return await WebAssembly.instantiateStreaming(module, imports);
            } catch (e) {
                const validResponse = module.ok && expectedResponseType(module.type);

                if (validResponse && module.headers.get('Content-Type') !== 'application/wasm') {
                    console.warn("`WebAssembly.instantiateStreaming` failed because your server does not serve Wasm with `application/wasm` MIME type. Falling back to `WebAssembly.instantiate` which is slower. Original error:\n", e);

                } else { throw e; }
            }
        }

        const bytes = await module.arrayBuffer();
        return await WebAssembly.instantiate(bytes, imports);
    } else {
        const instance = await WebAssembly.instantiate(module, imports);

        if (instance instanceof WebAssembly.Instance) {
            return { instance, module };
        } else {
            return instance;
        }
    }

    function expectedResponseType(type) {
        switch (type) {
            case 'basic': case 'cors': case 'default': return true;
        }
        return false;
    }
}

function initSync(module) {
    if (wasm !== undefined) return wasm;


    if (module !== undefined) {
        if (Object.getPrototypeOf(module) === Object.prototype) {
            ({module} = module)
        } else {
            console.warn('using deprecated parameters for `initSync()`; pass a single object instead')
        }
    }

    const imports = __wbg_get_imports();
    if (!(module instanceof WebAssembly.Module)) {
        module = new WebAssembly.Module(module);
    }
    const instance = new WebAssembly.Instance(module, imports);
    return __wbg_finalize_init(instance, module);
}

async function __wbg_init(module_or_path) {
    if (wasm !== undefined) return wasm;


    if (module_or_path !== undefined) {
        if (Object.getPrototypeOf(module_or_path) === Object.prototype) {
            ({module_or_path} = module_or_path)
        } else {
            console.warn('using deprecated parameters for the initialization function; pass a single object instead')
        }
    }

    if (module_or_path === undefined) {
        module_or_path = new URL('engine_wasm_bg.wasm', import.meta.url);
    }
    const imports = __wbg_get_imports();

    if (typeof module_or_path === 'string' || (typeof Request === 'function' && module_or_path instanceof Request) || (typeof URL === 'function' && module_or_path instanceof URL)) {
        module_or_path = fetch(module_or_path);
    }

    const { instance, module } = await __wbg_load(await module_or_path, imports);

    return __wbg_finalize_init(instance, module);
}

export { initSync, __wbg_init as default };
//#endregion
export { wasm as __wasm }
