import { z } from 'zod';
import { publicProcedure, router } from '../trpc';

const DATA_SERVICE_URL = process.env.DATA_SERVICE_URL ?? 'http://localhost:8888';

// ---------------------------------------------------------------------------
// Shared response shapes (mirrors Python PricesResponse)

const PricesResponse = z.object({
  dates: z.array(z.string()),
  tickers: z.array(z.string()),
  values: z.array(z.number()),
  n_periods: z.number(),
  n_assets: z.number(),
});

const TickerResult = z.object({
  symbol: z.string(),
  name: z.string(),
});

const SnapshotItem = z.object({
  ticker: z.string(),
  price: z.number(),
  change_pct: z.number(),
  sparkline: z.array(z.number()),
});

const FactorResponse = z.object({
  dates: z.array(z.string()),
  factor_names: z.array(z.string()),
  values: z.array(z.number()),
  rf_values: z.array(z.number()),
});

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const dataRouter = router({
  fetchPrices: publicProcedure
    .input(
      z.object({
        tickers: z.array(z.string()).min(1, 'At least one ticker is required'),
        start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'start must be YYYY-MM-DD'),
        end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'end must be YYYY-MM-DD'),
        interval: z.enum(['daily', 'weekly', 'monthly']).default('daily'),
      })
    )
    .query(async ({ input }) => {
      const res = await fetch(`${DATA_SERVICE_URL}/prices`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
        // Don't cache price data — always fresh
        cache: 'no-store',
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({ detail: res.statusText }));
        throw new Error(
          typeof body.detail === 'string'
            ? body.detail
            : JSON.stringify(body.detail)
        );
      }

      return PricesResponse.parse(await res.json());
    }),

  searchTickers: publicProcedure
    .input(z.object({ query: z.string().min(1) }))
    .query(async ({ input }) => {
      const url = new URL(`${DATA_SERVICE_URL}/tickers/search`);
      url.searchParams.set('q', input.query);

      const res = await fetch(url.toString(), { cache: 'no-store' });

      if (!res.ok) {
        throw new Error(`Ticker search failed: ${res.statusText}`);
      }

      return z.array(TickerResult).parse(await res.json());
    }),

  marketSnapshot: publicProcedure.query(async () => {
    const res = await fetch(`${DATA_SERVICE_URL}/market-snapshot`, {
      next: { revalidate: 300 }, // 5-min server-side cache
    });

    if (!res.ok) {
      throw new Error(`Market snapshot failed: ${res.statusText}`);
    }

    return z.array(SnapshotItem).parse(await res.json());
  }),

  portfolioSnapshot: publicProcedure
    .input(z.object({ tickers: z.array(z.string()).min(1).max(10) }))
    .query(async ({ input }) => {
      const url = new URL(`${DATA_SERVICE_URL}/market-snapshot`);
      input.tickers.forEach((t) => url.searchParams.append('tickers', t));
      const res = await fetch(url.toString(), { next: { revalidate: 300 } });

      if (!res.ok) {
        throw new Error(`Portfolio snapshot failed: ${res.statusText}`);
      }

      return z.array(SnapshotItem).parse(await res.json());
    }),

  pingDataService: publicProcedure
    .input(z.object({ url: z.string() }))
    .mutation(async ({ input }) => {
      const base = input.url.replace(/\/$/, '');
      try {
        const res = await fetch(`${base}/health`, {
          cache: 'no-store',
          signal: AbortSignal.timeout(3000),
        });
        return { ok: res.ok, status: res.status };
      } catch {
        return { ok: false, status: 0 };
      }
    }),

  fetchFactors: publicProcedure
    .input(
      z.object({
        start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        frequency: z.enum(['daily', 'monthly']).default('daily'),
        model: z.enum(['proxy', 'ff5']).default('proxy'),
      })
    )
    .query(async ({ input }) => {
      const res = await fetch(`${DATA_SERVICE_URL}/factor-returns`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
        cache: 'no-store',
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({ detail: res.statusText }));
        throw new Error(
          typeof body.detail === 'string' ? body.detail : JSON.stringify(body.detail)
        );
      }

      return FactorResponse.parse(await res.json());
    }),
});
