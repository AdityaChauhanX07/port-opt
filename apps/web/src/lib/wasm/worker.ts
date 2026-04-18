/**
 * WASM Web Worker
 *
 * Receives { id, method, payload } messages, dispatches to the engine, and
 * posts { id, result } or { id, error } back.  Float64Array results are
 * transferred (zero-copy) rather than copied.
 *
 * Built by Next.js webpack via:
 *   new Worker(new URL('./worker', import.meta.url))
 */

import {
  bootstrapSharpe,
  computeCorrelation,
  computeRiskMetrics,
  detectRegimes,
  runBacktestStatic,
  runBacktestWalkforward,
  runMonteCarlo,
  solveBlackLitterman,
  solveCvar,
  solveFrontier,
  solveHrp,
  solveRiskParity,
  solveRobust,
} from './engine';
import type { WorkerRequest, WorkerResponse } from './types';

// ---------------------------------------------------------------------------
// Collect all Float64Array buffers from a result for zero-copy transfer
// ---------------------------------------------------------------------------
function collectTransferables(value: unknown): Transferable[] {
  const transfers: Transferable[] = [];
  if (value instanceof Float64Array) {
    transfers.push(value.buffer);
    return transfers;
  }
  if (value && typeof value === 'object') {
    for (const v of Object.values(value as Record<string, unknown>)) {
      if (v instanceof Float64Array) {
        transfers.push(v.buffer);
      } else if (Array.isArray(v)) {
        // skip nested arrays — number[] doesn't need transfer
      }
    }
  }
  return transfers;
}

// ---------------------------------------------------------------------------
// Dispatch table
// ---------------------------------------------------------------------------
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyFn = (...args: any[]) => Promise<unknown>;

async function dispatch(method: string, payload: unknown): Promise<unknown> {
  // Each case destructures payload to the exact arguments expected by engine.ts
  switch (method) {
    case 'solveFrontier': {
      const p = payload as Parameters<typeof solveFrontier>[0];
      return solveFrontier(p);
    }
    case 'solveHrp': {
      const { returns, nPeriods, nAssets, tickers } = payload as {
        returns: Float64Array;
        nPeriods: number;
        nAssets: number;
        tickers: string[];
      };
      return solveHrp(returns, nPeriods, nAssets, tickers);
    }
    case 'solveRiskParity': {
      const { cov, nAssets, lb, ub } = payload as {
        cov: Float64Array;
        nAssets: number;
        lb: number;
        ub: number;
      };
      return solveRiskParity(cov, nAssets, lb, ub);
    }
    case 'solveCvar': {
      const { returns, nPeriods, nAssets, alpha, longOnly, lb, ub } =
        payload as {
          returns: Float64Array;
          nPeriods: number;
          nAssets: number;
          alpha: number;
          longOnly: boolean;
          lb: number;
          ub: number;
        };
      return solveCvar(returns, nPeriods, nAssets, alpha, longOnly, lb, ub);
    }
    case 'solveBlackLitterman': {
      const {
        cov, nAssets, marketWeights, rf, marketReturn,
        views, tau, longOnly, lb, ub, nPts,
      } = payload as {
        cov: Float64Array;
        nAssets: number;
        marketWeights: Float64Array;
        rf: number;
        marketReturn: number;
        views: Parameters<typeof solveBlackLitterman>[5];
        tau: number;
        longOnly: boolean;
        lb: number;
        ub: number;
        nPts: number;
      };
      return solveBlackLitterman(
        cov, nAssets, marketWeights, rf, marketReturn,
        views, tau, longOnly, lb, ub, nPts,
      );
    }
    case 'solveRobust': {
      const { returns, nPeriods, nAssets, gamma, longOnly, lb, ub, ppy } =
        payload as {
          returns: Float64Array;
          nPeriods: number;
          nAssets: number;
          gamma: number;
          longOnly: boolean;
          lb: number;
          ub: number;
          ppy?: number;
        };
      return solveRobust(
        returns,
        nPeriods,
        nAssets,
        gamma,
        longOnly,
        lb,
        ub,
        ppy,
      );
    }
    case 'runMonteCarlo': {
      return runMonteCarlo(
        payload as Parameters<typeof runMonteCarlo>[0],
      );
    }
    case 'runBacktestStatic': {
      const { returns, nPeriods, nAssets, weights, includeEw } =
        payload as {
          returns: Float64Array;
          nPeriods: number;
          nAssets: number;
          weights: Float64Array;
          includeEw?: boolean;
        };
      return runBacktestStatic(
        returns,
        nPeriods,
        nAssets,
        weights,
        includeEw,
      );
    }
    case 'runBacktestWalkforward': {
      const { returns, nPeriods, nAssets, config } = payload as {
        returns: Float64Array;
        nPeriods: number;
        nAssets: number;
        config?: Parameters<typeof runBacktestWalkforward>[3];
      };
      return runBacktestWalkforward(returns, nPeriods, nAssets, config);
    }
    case 'computeRiskMetrics': {
      const { returns, nPeriods, nAssets, weights, alpha, rf, ppy } =
        payload as {
          returns: Float64Array;
          nPeriods: number;
          nAssets: number;
          weights: Float64Array;
          alpha?: number;
          rf?: number;
          ppy?: number;
        };
      return computeRiskMetrics(
        returns,
        nPeriods,
        nAssets,
        weights,
        alpha,
        rf,
        ppy,
      );
    }
    case 'computeCorrelation': {
      const { returns, nPeriods, nAssets } = payload as {
        returns: Float64Array;
        nPeriods: number;
        nAssets: number;
      };
      return computeCorrelation(returns, nPeriods, nAssets);
    }
    case 'detectRegimes': {
      const { returns, nRegimes, maxIter, seed } = payload as {
        returns: Float64Array;
        nRegimes?: number;
        maxIter?: number;
        seed?: number;
      };
      return detectRegimes(returns, nRegimes, maxIter, seed);
    }
    case 'bootstrapSharpe': {
      const { returns, rfPerPeriod, nBoot, blockSize, ci, seed } =
        payload as {
          returns: Float64Array;
          rfPerPeriod: number;
          nBoot: number;
          blockSize: number;
          ci: number;
          seed: number;
        };
      return bootstrapSharpe(
        returns,
        rfPerPeriod,
        nBoot,
        blockSize,
        ci,
        seed,
      );
    }
    default:
      throw new Error(`Unknown engine method: ${method}`);
  }
}

// ---------------------------------------------------------------------------
// Message handler
// ---------------------------------------------------------------------------

self.addEventListener('message', async (event: MessageEvent<WorkerRequest>) => {
  const { id, method, payload } = event.data;
  try {
    const result = await dispatch(method, payload);
    const transfers = collectTransferables(result);
    const response: WorkerResponse = { id, result };
    (self as unknown as Worker).postMessage(response, transfers);
  } catch (err) {
    const response: WorkerResponse = {
      id,
      error: err instanceof Error ? err.message : String(err),
    };
    (self as unknown as Worker).postMessage(response);
  }
});
