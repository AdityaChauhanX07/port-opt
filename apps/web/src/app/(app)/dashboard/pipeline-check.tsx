'use client';

import { api } from '@/lib/trpc/client';

/**
 * Validates the full pipeline: Next.js → tRPC → Python service → Yahoo Finance.
 * Displays a summary of the fetched AAPL price data.
 */
export function PipelineCheck() {
  const { data, error, isLoading } = api.data.fetchPrices.useQuery({
    tickers: ['AAPL'],
    start: '2024-01-01',
    end: '2025-01-01',
    interval: 'daily',
  });

  if (isLoading) {
    return (
      <div className="rounded-lg border border-gray-200 bg-gray-50 p-6 max-w-sm">
        <p className="text-sm text-gray-500">Fetching AAPL prices…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-6 max-w-sm">
        <p className="text-sm font-medium text-red-700">Pipeline error</p>
        <p className="mt-1 text-xs text-red-600 font-mono">{error.message}</p>
      </div>
    );
  }

  const firstPrice = data!.values[0]?.toFixed(2);
  const lastPrice = data!.values[data!.n_periods - 1]?.toFixed(2);

  return (
    <div className="rounded-lg border border-green-200 bg-green-50 p-6 max-w-sm space-y-3">
      <p className="text-sm font-semibold text-green-800">
        Pipeline OK — Next.js → tRPC → Python → Yahoo Finance
      </p>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
        <dt className="text-gray-500">Ticker</dt>
        <dd className="font-mono font-medium">{data!.tickers[0]}</dd>

        <dt className="text-gray-500">Periods</dt>
        <dd className="font-mono font-medium">{data!.n_periods}</dd>

        <dt className="text-gray-500">First date</dt>
        <dd className="font-mono font-medium">{data!.dates[0]}</dd>

        <dt className="text-gray-500">Last date</dt>
        <dd className="font-mono font-medium">{data!.dates[data!.dates.length - 1]}</dd>

        <dt className="text-gray-500">First price</dt>
        <dd className="font-mono font-medium">${firstPrice}</dd>

        <dt className="text-gray-500">Last price</dt>
        <dd className="font-mono font-medium">${lastPrice}</dd>
      </dl>
    </div>
  );
}
