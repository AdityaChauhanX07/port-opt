import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';

// ---------------------------------------------------------------------------
// State shape
// ---------------------------------------------------------------------------

export interface FrontierState {
  weights: Float64Array;
  risks: Float64Array;
  returns: Float64Array;
  sharpes: Float64Array;
  bestIdx: number | null;
  nPoints: number;
  nAssets: number;
}

export interface PortfolioState {
  // ---------- Input ----------
  tickers: string[];
  dateRange: { start: string; end: string };
  frequency: 'daily' | 'weekly' | 'monthly';
  returnModel: 'log' | 'simple';

  // ---------- Data (fetched from data service via tRPC) ----------
  /**
   * Adjusted-close price matrix — column-major layout as returned by the data
   * service: [ticker0_t0, ticker0_t1, …, ticker1_t0, …].
   * Length = nPeriods × nAssets.
   */
  prices: Float64Array | null;
  /**
   * Period returns computed from prices — row-major layout ready for WASM:
   * [t0_a0, t0_a1, …, t1_a0, …].
   * Length = (nPeriods − 1) × nAssets.
   */
  returns: Float64Array | null;
  dates: string[];
  nPeriods: number;
  nAssets: number;
  isLoadingData: boolean;

  // ---------- Optimisation (computed by WASM) ----------
  frontier: FrontierState | null;
  activeAlgorithm: 'markowitz' | 'hrp' | 'risk_parity' | 'cvar' | 'robust';
  currentWeights: Float64Array | null;
  isOptimizing: boolean;

  // ---------- Constraints ----------
  longOnly: boolean;
  lb: number;
  ub: number;
  rf: number;
  shrinkageAlpha: number;
  nPoints: number;

  // ---------- Actions ----------
  setTickers: (t: string[]) => void;
  setDateRange: (start: string, end: string) => void;
  setFrequency: (f: 'daily' | 'weekly' | 'monthly') => void;
  setReturnModel: (m: 'log' | 'simple') => void;
  setLoadingData: (b: boolean) => void;
  setConstraints: (
    c: Partial<{
      longOnly: boolean;
      lb: number;
      ub: number;
      rf: number;
      shrinkageAlpha: number;
      nPoints: number;
    }>
  ) => void;
  setPriceData: (data: {
    prices: Float64Array;
    dates: string[];
    nPeriods: number;
    nAssets: number;
  }) => void;
  setFrontier: (f: FrontierState | null) => void;
  setWeights: (w: Float64Array) => void;
  setActiveAlgorithm: (a: PortfolioState['activeAlgorithm']) => void;
  setOptimizing: (b: boolean) => void;
  reset: () => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Convert column-major prices (nAssets × nPeriods) to row-major log-returns
 * (nPeriods-1 × nAssets).
 *
 * Column-major layout: [ticker0_t0, ticker0_t1, …, ticker1_t0, …]
 * Row-major returns:   [t0_a0, t0_a1, …, t1_a0, …]
 */
function computeLogReturns(
  prices: Float64Array,
  nPeriods: number,
  nAssets: number,
): Float64Array {
  const nRet = nPeriods - 1;
  const out = new Float64Array(nRet * nAssets);
  for (let t = 0; t < nRet; t++) {
    for (let a = 0; a < nAssets; a++) {
      const curr = prices[a * nPeriods + t + 1];
      const prev = prices[a * nPeriods + t];
      out[t * nAssets + a] = prev > 0 ? Math.log(curr / prev) : 0;
    }
  }
  return out;
}

function computeSimpleReturns(
  prices: Float64Array,
  nPeriods: number,
  nAssets: number,
): Float64Array {
  const nRet = nPeriods - 1;
  const out = new Float64Array(nRet * nAssets);
  for (let t = 0; t < nRet; t++) {
    for (let a = 0; a < nAssets; a++) {
      const curr = prices[a * nPeriods + t + 1];
      const prev = prices[a * nPeriods + t];
      out[t * nAssets + a] = prev > 0 ? curr / prev - 1 : 0;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Initial state
// ---------------------------------------------------------------------------

const DEFAULT_DATE_RANGE = (() => {
  const end = new Date();
  const start = new Date(end);
  start.setFullYear(start.getFullYear() - 3);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  return { start: fmt(start), end: fmt(end) };
})();

const INITIAL: Omit<
  PortfolioState,
  | 'setTickers'
  | 'setDateRange'
  | 'setFrequency'
  | 'setReturnModel'
  | 'setLoadingData'
  | 'setConstraints'
  | 'setPriceData'
  | 'setFrontier'
  | 'setWeights'
  | 'setActiveAlgorithm'
  | 'setOptimizing'
  | 'reset'
> = {
  tickers: [],
  dateRange: DEFAULT_DATE_RANGE,
  frequency: 'daily',
  returnModel: 'log',
  prices: null,
  returns: null,
  dates: [],
  nPeriods: 0,
  nAssets: 0,
  isLoadingData: false,
  frontier: null,
  activeAlgorithm: 'markowitz',
  currentWeights: null,
  isOptimizing: false,
  longOnly: true,
  lb: 0,
  ub: 1,
  rf: 0,
  shrinkageAlpha: 0.1,
  nPoints: 20,
};

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const usePortfolioStore = create<PortfolioState>()(
  immer((set, get) => ({
    ...INITIAL,

    setTickers: (t) =>
      set((state) => {
        state.tickers = t;
      }),

    setDateRange: (start, end) =>
      set((state) => {
        state.dateRange = { start, end };
      }),

    setFrequency: (f) =>
      set((state) => {
        state.frequency = f;
      }),

    setReturnModel: (m) =>
      set((state) => {
        // Recompute returns if we already have prices
        if (state.prices && state.nPeriods > 0 && state.nAssets > 0) {
          state.returns =
            m === 'log'
              ? computeLogReturns(state.prices, state.nPeriods, state.nAssets)
              : computeSimpleReturns(
                  state.prices,
                  state.nPeriods,
                  state.nAssets,
                );
        }
        state.returnModel = m;
      }),

    setLoadingData: (b) =>
      set((state) => {
        state.isLoadingData = b;
      }),

    setConstraints: (c) =>
      set((state) => {
        if (c.longOnly !== undefined) state.longOnly = c.longOnly;
        if (c.lb !== undefined) state.lb = c.lb;
        if (c.ub !== undefined) state.ub = c.ub;
        if (c.rf !== undefined) state.rf = c.rf;
        if (c.shrinkageAlpha !== undefined)
          state.shrinkageAlpha = c.shrinkageAlpha;
        if (c.nPoints !== undefined) state.nPoints = c.nPoints;
      }),

    setPriceData: ({ prices, dates, nPeriods, nAssets }) =>
      set((state) => {
        state.prices = prices;
        state.dates = dates;
        state.nPeriods = nPeriods;
        state.nAssets = nAssets;
        // Compute returns in the chosen model immediately
        state.returns =
          state.returnModel === 'log'
            ? computeLogReturns(prices, nPeriods, nAssets)
            : computeSimpleReturns(prices, nPeriods, nAssets);
        // Clear stale optimisation outputs
        state.frontier = null;
        state.currentWeights = null;
        state.isLoadingData = false;
      }),

    setFrontier: (f) =>
      set((state) => {
        state.frontier = f;
      }),

    setWeights: (w) =>
      set((state) => {
        state.currentWeights = w;
      }),

    setActiveAlgorithm: (a) =>
      set((state) => {
        state.activeAlgorithm = a;
      }),

    setOptimizing: (b) =>
      set((state) => {
        state.isOptimizing = b;
      }),

    reset: () =>
      set((state) => {
        Object.assign(state, INITIAL);
      }),
  }))
);
