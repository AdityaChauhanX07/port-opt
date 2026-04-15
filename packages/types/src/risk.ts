export interface RiskMetrics {
  var95: number;
  cvar95: number;
  meanReturn: number;
}

export interface TerminalSummary {
  mean: number;
  median: number;
  p5: number;
  p25: number;
  p75: number;
  p95: number;
  probLoss: number;
}

export interface MonteCarloResult {
  paths: Float64Array;
  nSteps: number;
  nPaths: number;
  summary: TerminalSummary;
}

export interface RollingMetrics {
  dates: string[];
  sharpe: number[];
  sortino: number[];
}
