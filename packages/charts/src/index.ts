// D3-based chart components — frontier chart, equity curve, fan chart, etc.

export { EfficientFrontier } from './EfficientFrontier';
export type { EfficientFrontierProps, FrontierPoint, AssetStat, AlgorithmMarker, HoverMetrics } from './EfficientFrontier';

export { WeightBar } from './WeightBar';
export type { WeightBarProps } from './WeightBar';

export { EquityChart } from './EquityChart';
export type { EquityChartProps, EquitySeries } from './EquityChart';

export { DrawdownChart } from './DrawdownChart';
export type { DrawdownChartProps, DrawdownSeries } from './DrawdownChart';

export { WeightEvolution } from './WeightEvolution';
export type { WeightEvolutionProps } from './WeightEvolution';

export { SankeyFlow } from './SankeyFlow';
export type { SankeyFlowProps } from './SankeyFlow';

export { Histogram } from './Histogram';
export type { HistogramProps, HistogramMarker } from './Histogram';

export { GroupedBarChart } from './GroupedBarChart';
export type { GroupedBarChartProps, BarGroup, GroupedBar } from './GroupedBarChart';

export { MonteCarloFan } from './MonteCarloFan';
export type { MonteCarloFanProps } from './MonteCarloFan';

export { CorrelationMatrix } from './CorrelationMatrix';
export type { CorrelationMatrixProps } from './CorrelationMatrix';

export { TimeSeriesLine } from './TimeSeriesLine';
export type { TimeSeriesLineProps, TimeSeriesLineSeries, TimeSeriesRefLine } from './TimeSeriesLine';

export { RegimeTimeline } from './RegimeTimeline';
export type { RegimeTimelineProps } from './RegimeTimeline';
