import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import type { MonteCarloResult } from '../wasm/types';

// ---------------------------------------------------------------------------
// Sub-types
// ---------------------------------------------------------------------------

export interface McParams {
  horizon: number;
  nPaths: number;
  seed: number;
  muAnnual: number;
  volAnnual: number;
  ppy: number;
}

export interface StressStat {
  label: string;
  cumRet: number;
  maxDD: number;
  recoveryDays: number | null;
}

export interface StressPeriodResult {
  name: string;
  startDate: string;
  endDate: string;
  series: StressStat[];
}

// ---------------------------------------------------------------------------
// State shape
// ---------------------------------------------------------------------------

interface RiskState {
  // Monte Carlo cache
  mcResult: MonteCarloResult | null;
  mcParams: McParams | null;
  isMcRunning: boolean;
  mcError: string | null;

  // Correlation matrix cache
  corrMatrix: Float64Array | null;
  isCorrLoading: boolean;
  corrError: string | null;

  // Stress period results (computed in JS, no WASM)
  stressResults: StressPeriodResult[];

  // Actions
  setMcResult: (r: MonteCarloResult, params: McParams) => void;
  setMcRunning: (b: boolean) => void;
  setMcError: (e: string | null) => void;

  setCorrMatrix: (m: Float64Array) => void;
  setCorrLoading: (b: boolean) => void;
  setCorrError: (e: string | null) => void;

  setStressResults: (r: StressPeriodResult[]) => void;
  reset: () => void;
}

// ---------------------------------------------------------------------------
// Initial state
// ---------------------------------------------------------------------------

const INITIAL = {
  mcResult: null as MonteCarloResult | null,
  mcParams: null as McParams | null,
  isMcRunning: false,
  mcError: null as string | null,
  corrMatrix: null as Float64Array | null,
  isCorrLoading: false,
  corrError: null as string | null,
  stressResults: [] as StressPeriodResult[],
};

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useRiskStore = create<RiskState>()(
  immer((set) => ({
    ...INITIAL,

    setMcResult: (r, params) =>
      set((s) => {
        s.mcResult = r;
        s.mcParams = params;
      }),
    setMcRunning: (b) =>
      set((s) => {
        s.isMcRunning = b;
      }),
    setMcError: (e) =>
      set((s) => {
        s.mcError = e;
      }),

    setCorrMatrix: (m) =>
      set((s) => {
        s.corrMatrix = m;
      }),
    setCorrLoading: (b) =>
      set((s) => {
        s.isCorrLoading = b;
      }),
    setCorrError: (e) =>
      set((s) => {
        s.corrError = e;
      }),

    setStressResults: (r) =>
      set((s) => {
        s.stressResults = r;
      }),

    reset: () =>
      set((s) => {
        Object.assign(s, INITIAL);
      }),
  }))
);
