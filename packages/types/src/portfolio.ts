export interface Ticker {
  symbol: string;
  name: string;
}

export interface PortfolioConfig {
  tickers: Ticker[];
  dateRange: { start: string; end: string };
  frequency: 'daily' | 'weekly' | 'monthly';
  returnModel: 'arithmetic' | 'log';
}

export interface WeightVector {
  weights: number[];
  tickers: string[];
}
