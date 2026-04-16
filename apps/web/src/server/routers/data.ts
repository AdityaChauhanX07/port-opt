import { z } from 'zod';
import { publicProcedure, router } from '../trpc';

const DATA_SERVICE_URL = process.env.DATA_SERVICE_URL ?? 'http://localhost:8888';

// ---------------------------------------------------------------------------
// Shared response shapes (mirrors Python PricesResponse)
// ---------------------------------------------------------------------------

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
});
