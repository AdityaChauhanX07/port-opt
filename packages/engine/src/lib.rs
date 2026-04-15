pub mod backtest;
pub mod linalg;
pub mod monte_carlo;
pub mod optimize;
pub mod risk;
pub mod stats;

// ---------------------------------------------------------------------------
// Crate-wide error type
// ---------------------------------------------------------------------------

/// Errors that engine computations can return.
#[derive(Debug)]
pub enum EngineError {
    /// The QP solver terminated with a non-optimal status.
    OptimizationFailed(String),
    /// The QP solver determined the problem is infeasible.
    InfeasibleProblem,
    /// Caller-supplied arguments are inconsistent or out of range.
    InvalidInput(String),
    /// Not enough observations to perform the requested computation.
    InsufficientData(String),
}

impl std::fmt::Display for EngineError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::OptimizationFailed(msg) => write!(f, "optimization failed: {msg}"),
            Self::InfeasibleProblem => write!(f, "problem is infeasible"),
            Self::InvalidInput(msg) => write!(f, "invalid input: {msg}"),
            Self::InsufficientData(msg) => write!(f, "insufficient data: {msg}"),
        }
    }
}

impl std::error::Error for EngineError {}
