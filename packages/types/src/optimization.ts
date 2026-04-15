export enum Algorithm {
  Markowitz = 'Markowitz',
  HRP = 'HRP',
  RiskParity = 'RiskParity',
  CVaR = 'CVaR',
  RobustMVO = 'RobustMVO',
  BlackLitterman = 'BlackLitterman',
}

export interface FrontierPoint {
  risk: number;
  return: number;
  sharpe: number;
  weights: number[];
}

export interface FrontierResult {
  points: FrontierPoint[];
  bestIdx: number;
  algorithm: Algorithm;
}

export interface ConstraintSet {
  longOnly: boolean;
  lb: number[];
  ub: number[];
  rf: number;
  shrinkageAlpha: number;
  nPoints: number;
}
