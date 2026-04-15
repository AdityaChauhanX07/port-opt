export interface BacktestConfig {
  mode: 'rolling' | 'expanding' | 'oos';
  window: number;
  step: number;
  tcBps: number;
  slippageBps: number;
  oosStartFraction: number;
}

export interface BacktestMetrics {
  annReturn: number;
  annVol: number;
  sharpe: number;
  maxDD: number;
  cagr: number;
}

export interface BacktestResult {
  equity: number[];
  drawdown: number[];
  metrics: BacktestMetrics;
  weightsHistory: number[][];
}
