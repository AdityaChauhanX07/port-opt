// Monte Carlo simulation: GBM path generation, terminal distribution summary statistics
pub mod bootstrap;
pub mod gbm;

pub use bootstrap::{sharpe_ci, BootstrapResult};
pub use gbm::{simulate, GbmParams, TerminalSummary};
