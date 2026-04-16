import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import type { BacktestResult, WalkforwardResult } from '@/lib/wasm/types';

// ---------------------------------------------------------------------------
// Config shape
// ---------------------------------------------------------------------------

export interface BacktestConfig {
  mode: 'static' | 'walkforward';
  /** Which weights to use for static mode. */
  strategySource: 'current' | 'markowitz' | 'hrp' | 'riskparity';
  /** Lookback window in periods (walk-forward). */
  window: number;
  /** Rebalance step in periods (walk-forward). */
  step: number;
  /** Transaction cost in basis points. */
  tcBps: number;
  /** Slippage in basis points. */
  slippageBps: number;
  /** Fraction of data reserved for OOS (walk-forward). */
  oosFraction: number;
  benchmarks: {
    ew: boolean;
  };
}

// ---------------------------------------------------------------------------
// State shape
// ---------------------------------------------------------------------------

export interface BacktestState {
  config: BacktestConfig;
  result: BacktestResult | WalkforwardResult | null;
  resultMode: 'static' | 'walkforward' | null;
  isRunning: boolean;
  error: string | null;

  // Actions
  setConfig: (patch: Partial<BacktestConfig>) => void;
  setBenchmarks: (patch: Partial<BacktestConfig['benchmarks']>) => void;
  setResult: (
    r: BacktestResult | WalkforwardResult | null,
    mode: 'static' | 'walkforward' | null,
  ) => void;
  setRunning: (b: boolean) => void;
  setError: (e: string | null) => void;
  reset: () => void;
}

// ---------------------------------------------------------------------------
// Initial state
// ---------------------------------------------------------------------------

const INITIAL_CONFIG: BacktestConfig = {
  mode: 'walkforward',
  strategySource: 'markowitz',
  window: 252,
  step: 63,
  tcBps: 10,
  slippageBps: 5,
  oosFraction: 0.3,
  benchmarks: { ew: true },
};

const INITIAL: Omit<
  BacktestState,
  'setConfig' | 'setBenchmarks' | 'setResult' | 'setRunning' | 'setError' | 'reset'
> = {
  config: INITIAL_CONFIG,
  result: null,
  resultMode: null,
  isRunning: false,
  error: null,
};

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useBacktestStore = create<BacktestState>()(
  immer((set) => ({
    ...INITIAL,

    setConfig: (patch) =>
      set((state) => {
        Object.assign(state.config, patch);
      }),

    setBenchmarks: (patch) =>
      set((state) => {
        Object.assign(state.config.benchmarks, patch);
      }),

    setResult: (r, mode) =>
      set((state) => {
        state.result = r;
        state.resultMode = mode;
      }),

    setRunning: (b) =>
      set((state) => {
        state.isRunning = b;
      }),

    setError: (e) =>
      set((state) => {
        state.error = e;
      }),

    reset: () =>
      set((state) => {
        Object.assign(state, INITIAL);
      }),
  }))
);
