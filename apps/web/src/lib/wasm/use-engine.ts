'use client';

/**
 * useEngine — React hook that wraps the WASM Web Worker.
 *
 * Creates one Worker instance per component tree (cached in a module-level
 * ref so the same worker is reused across re-renders).  Returns async
 * methods matching the engine.ts API that resolve once the worker replies.
 *
 * Falls back gracefully when the WASM pkg is not yet built:
 * every call will reject with "WASM engine not loaded".
 */

import { useCallback, useEffect, useRef } from 'react';
import type {
  BacktestResult,
  BootstrapResult,
  EngineMethod,
  FrontierResult,
  MonteCarloParams,
  MonteCarloResult,
  RiskMetrics,
  SolveFrontierParams,
  WalkforwardConfig,
  WalkforwardResult,
  WorkerRequest,
  WorkerResponse,
} from './types';

// ---------------------------------------------------------------------------
// Module-level worker singleton (survives re-renders, unmount/remount)
// ---------------------------------------------------------------------------

let _sharedWorker: Worker | null = null;
let _pendingMap = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
let _nextId = 1;

function getWorker(): Worker | null {
  if (typeof window === 'undefined') return null; // SSR guard

  if (!_sharedWorker) {
    try {
      // Next.js webpack bundles this as a separate chunk
      _sharedWorker = new Worker(new URL('./worker', import.meta.url), {
        type: 'module',
      });
      _sharedWorker.addEventListener(
        'message',
        (event: MessageEvent<WorkerResponse>) => {
          const { id, result, error } = event.data;
          const pending = _pendingMap.get(id);
          if (!pending) return;
          _pendingMap.delete(id);
          if (error) {
            pending.reject(new Error(error));
          } else {
            pending.resolve(result);
          }
        },
      );
      _sharedWorker.addEventListener('error', (event) => {
        // Reject all pending calls if the worker crashes
        const msg = event.message ?? 'Worker error';
        for (const { reject } of _pendingMap.values()) {
          reject(new Error(msg));
        }
        _pendingMap.clear();
        _sharedWorker = null;
      });
    } catch {
      // Worker creation failed (e.g. WASM not supported)
      return null;
    }
  }

  return _sharedWorker;
}

/** Send a request to the worker and return a Promise for the response. */
function call<T>(
  method: EngineMethod,
  payload: unknown,
  transfer?: Transferable[],
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const worker = getWorker();
    if (!worker) {
      reject(new Error('WASM engine not loaded — run build-wasm.sh first'));
      return;
    }

    const id = _nextId++;
    _pendingMap.set(id, {
      resolve: (v) => resolve(v as T),
      reject,
    });

    const request: WorkerRequest = { id, method, payload };
    if (transfer && transfer.length > 0) {
      worker.postMessage(request, transfer);
    } else {
      worker.postMessage(request);
    }
  });
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export interface EngineAPI {
  /** True when the worker+WASM is available (set after first successful call). */
  ready: boolean;

  solveFrontier(params: SolveFrontierParams): Promise<FrontierResult>;

  solveHrp(
    returns: Float64Array,
    nPeriods: number,
    nAssets: number,
    tickers: string[],
  ): Promise<Float64Array>;

  solveRiskParity(
    cov: Float64Array,
    nAssets: number,
    lb: number,
    ub: number,
  ): Promise<Float64Array>;

  solveCvar(
    returns: Float64Array,
    nPeriods: number,
    nAssets: number,
    alpha: number,
    longOnly: boolean,
    lb: number,
    ub: number,
  ): Promise<Float64Array>;

  solveRobust(
    returns: Float64Array,
    nPeriods: number,
    nAssets: number,
    gamma: number,
    longOnly: boolean,
    lb: number,
    ub: number,
    ppy?: number,
  ): Promise<Float64Array>;

  runMonteCarlo(params: MonteCarloParams): Promise<MonteCarloResult>;

  runBacktestStatic(
    returns: Float64Array,
    nPeriods: number,
    nAssets: number,
    weights: Float64Array,
    includeEw?: boolean,
  ): Promise<BacktestResult>;

  runBacktestWalkforward(
    returns: Float64Array,
    nPeriods: number,
    nAssets: number,
    config?: WalkforwardConfig,
  ): Promise<WalkforwardResult>;

  computeRiskMetrics(
    returns: Float64Array,
    nPeriods: number,
    nAssets: number,
    weights: Float64Array,
    alpha?: number,
    rf?: number,
    ppy?: number,
  ): Promise<RiskMetrics>;

  computeCorrelation(
    returns: Float64Array,
    nPeriods: number,
    nAssets: number,
  ): Promise<Float64Array>;

  bootstrapSharpe(
    returns: Float64Array,
    rfPerPeriod: number,
    nBoot: number,
    blockSize: number,
    ci: number,
    seed: number,
  ): Promise<BootstrapResult>;
}

export function useEngine(): EngineAPI {
  const readyRef = useRef(false);

  useEffect(() => {
    // Warm up the worker on mount so WASM is loaded before the user
    // triggers their first computation
    const w = getWorker();
    if (w) readyRef.current = true;
  }, []);

  // All methods are stable (module-level `call` never changes)
  return {
    get ready() {
      return readyRef.current;
    },

    solveFrontier: useCallback(
      (params) =>
        call<FrontierResult>('solveFrontier', params),
      [],
    ),

    solveHrp: useCallback(
      (returns, nPeriods, nAssets, tickers) =>
        call<Float64Array>('solveHrp', { returns, nPeriods, nAssets, tickers }),
      [],
    ),

    solveRiskParity: useCallback(
      (cov, nAssets, lb, ub) =>
        call<Float64Array>('solveRiskParity', { cov, nAssets, lb, ub }),
      [],
    ),

    solveCvar: useCallback(
      (returns, nPeriods, nAssets, alpha, longOnly, lb, ub) =>
        call<Float64Array>('solveCvar', {
          returns,
          nPeriods,
          nAssets,
          alpha,
          longOnly,
          lb,
          ub,
        }),
      [],
    ),

    solveRobust: useCallback(
      (returns, nPeriods, nAssets, gamma, longOnly, lb, ub, ppy) =>
        call<Float64Array>('solveRobust', {
          returns,
          nPeriods,
          nAssets,
          gamma,
          longOnly,
          lb,
          ub,
          ppy,
        }),
      [],
    ),

    runMonteCarlo: useCallback(
      (params) => call<MonteCarloResult>('runMonteCarlo', params),
      [],
    ),

    runBacktestStatic: useCallback(
      (returns, nPeriods, nAssets, weights, includeEw) =>
        call<BacktestResult>('runBacktestStatic', {
          returns,
          nPeriods,
          nAssets,
          weights,
          includeEw,
        }),
      [],
    ),

    runBacktestWalkforward: useCallback(
      (returns, nPeriods, nAssets, config) =>
        call<WalkforwardResult>('runBacktestWalkforward', {
          returns,
          nPeriods,
          nAssets,
          config,
        }),
      [],
    ),

    computeRiskMetrics: useCallback(
      (returns, nPeriods, nAssets, weights, alpha, rf, ppy) =>
        call<RiskMetrics>('computeRiskMetrics', {
          returns,
          nPeriods,
          nAssets,
          weights,
          alpha,
          rf,
          ppy,
        }),
      [],
    ),

    computeCorrelation: useCallback(
      (returns, nPeriods, nAssets) =>
        call<Float64Array>('computeCorrelation', {
          returns,
          nPeriods,
          nAssets,
        }),
      [],
    ),

    bootstrapSharpe: useCallback(
      (returns, rfPerPeriod, nBoot, blockSize, ci, seed) =>
        call<BootstrapResult>('bootstrapSharpe', {
          returns,
          rfPerPeriod,
          nBoot,
          blockSize,
          ci,
          seed,
        }),
      [],
    ),
  };
}
