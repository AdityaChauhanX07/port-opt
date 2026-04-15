// Walk-forward and expanding-window backtesting with transaction cost and slippage models
pub mod costs;
pub mod static_bt;
pub mod walkforward;

pub use costs::flat_cost;
pub use static_bt::{run as static_run, StaticBacktestResult};
pub use walkforward::{run as walkforward_run, WalkforwardConfig, WalkforwardResult};
