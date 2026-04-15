export interface PriceRequest {
  tickers: string[];
  start: string;
  end: string;
  interval: string;
}

export interface PriceResponse {
  dates: string[];
  tickers: string[];
  values: number[];
  nPeriods: number;
  nAssets: number;
}
