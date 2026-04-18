/**
 * Portfolio persistence layer.
 *
 * - Development (no KV_REST_API_URL env var): module-level in-memory Map.
 *   Data survives server restarts only for the duration of the process.
 * - Production / Vercel: @vercel/kv (Redis-compatible, edge-ready).
 *
 * All functions are async so callers are the same regardless of backend.
 */

import { randomUUID } from 'crypto';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SavedPortfolio {
  id: string;
  userId: string;
  name: string;
  tickers: string[];
  weights: number[];
  algorithm: string;
  constraints: {
    longOnly: boolean;
    lb: number;
    ub: number;
    rf: number;
  };
  metrics: {
    annReturn: number;
    annVol: number;
    sharpe: number;
    maxDD: number;
  };
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// In-memory fallback (dev)
// ---------------------------------------------------------------------------

const _store = new Map<string, SavedPortfolio[]>();

function memKey(userId: string) {
  return `user:${userId}:portfolios`;
}

function memList(userId: string): SavedPortfolio[] {
  return _store.get(memKey(userId)) ?? [];
}

function memSet(userId: string, portfolios: SavedPortfolio[]) {
  _store.set(memKey(userId), portfolios);
}

// ---------------------------------------------------------------------------
// KV (production)
// ---------------------------------------------------------------------------

const useKV = !!process.env.KV_REST_API_URL;

async function kvList(userId: string): Promise<SavedPortfolio[]> {
  const { kv } = await import('@vercel/kv');
  const raw = await kv.get<SavedPortfolio[]>(memKey(userId));
  return raw ?? [];
}

async function kvSet(userId: string, portfolios: SavedPortfolio[]) {
  const { kv } = await import('@vercel/kv');
  await kv.set(memKey(userId), portfolios);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function listPortfolios(userId: string): Promise<SavedPortfolio[]> {
  const portfolios = useKV ? await kvList(userId) : memList(userId);
  // Sort newest first
  return portfolios.slice().sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  );
}

export async function getPortfolio(
  userId: string,
  id: string
): Promise<SavedPortfolio | null> {
  const list = await listPortfolios(userId);
  return list.find((p) => p.id === id) ?? null;
}

export async function savePortfolio(
  userId: string,
  data: Omit<SavedPortfolio, 'id' | 'userId' | 'createdAt' | 'updatedAt'>
): Promise<SavedPortfolio> {
  const now = new Date().toISOString();
  const portfolio: SavedPortfolio = {
    ...data,
    id: randomUUID(),
    userId,
    createdAt: now,
    updatedAt: now,
  };

  const list = await listPortfolios(userId);
  const updated = [portfolio, ...list];

  if (useKV) {
    await kvSet(userId, updated);
  } else {
    memSet(userId, updated);
  }

  return portfolio;
}

export async function deletePortfolio(
  userId: string,
  id: string
): Promise<boolean> {
  const list = await listPortfolios(userId);
  const filtered = list.filter((p) => p.id !== id);
  if (filtered.length === list.length) return false; // not found

  if (useKV) {
    await kvSet(userId, filtered);
  } else {
    memSet(userId, filtered);
  }
  return true;
}
