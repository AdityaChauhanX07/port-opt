# Portfolio Optimization App

An interactive web application for quantitative portfolio analysis and optimization, implementing modern mean–variance optimization and backtesting workflows using Streamlit, Plotly, and CVXPY.

**Live App:** [https://adityachauhanx07.github.io/port-opt/](https://adityachauhanx07.github.io/port-opt/)

---
## Overview

This application provides an end-to-end framework for constructing and evaluating optimized portfolios. Users can fetch historical data from Yahoo Finance, estimate expected returns and covariances, visualize the efficient frontier, and backtest the resulting strategy against benchmarks. The interface enables dynamic experimentation with assets, bounds, and parameters through an intuitive Streamlit dashboard.

---

## Core Features
- **Data Pipeline:** Automated price retrieval via `yfinance`, with preprocessing, alignment, and cleaning.  
- **Return Models:** Support for log and simple returns, with adjustable lookback frequency.  
- **Optimization Engine:** Mean–variance optimization powered by `cvxpy`, supporting long-only constraints and custom bounds.  
- **Visualization:** Interactive efficient frontier, maximum Sharpe portfolio highlight, and performance metrics rendered with Plotly.  
- **Backtesting:** Static portfolio backtest with cumulative equity curve, drawdown visualization, and benchmark comparison.  
- **Export:** Downloadable CSV outputs for portfolio weights, metrics, and frontier data.

---

## Technology Stack
| Layer | Components |
|--------|-------------|
| **Frontend** | Streamlit, Plotly, Pandas |
| **Backend** | NumPy, CVXPY, Yahoo Finance API |
| **Testing & CI** | Pytest, GitHub Actions |
| **Deployment** | Streamlit Cloud |

---
## Directory Structure
```
port-opt/
│
├── src/
│   └── portopt/
│       ├── app/                # Streamlit user interface
│       ├── core/               # Core analytics and optimization modules
│       └── __init__.py
│
├── tests/                      # Unit and integration tests
│
├── requirements.txt            # Dependencies
├── runtime.txt                 # Python version (for Streamlit Cloud)
├── .github/workflows/ci.yml    # CI pipeline configuration
└── README.md                   # Documentation
```
---
## Local Setup
### 1. Clone the repository
```bash
git clone https://github.com/AdityaChauhanX07/port-opt.git
cd port-opt
```
### 2. Create and activate a virtual environment
```bash
python -m venv .venv
.venv\Scripts\activate   # On Windows
# source .venv/bin/activate   # On macOS/Linux
```
### 3. Install dependencies
```bash
pip install -r requirements.txt
```
### 4. Run the application
```bash
streamlit run src/portopt/app/ui.py
```
---
## Example Usage
1. Input ticker symbols such as:
```
AAPL, MSFT, TLT, GLD, IWM, SPY
```
2. Choose frequency (Daily / Weekly / Monthly) and return model (Log / Simple).
3. Load the data and compute portfolio statistics.
4. Solve for the efficient frontier and inspect results.
5. Backtest and compare with equal-weight and market portfolios.
6. Export results for further analysis.
---
## Testing
Automated tests verify data consistency, optimization stability, and calculation correctness.
Run locally using:
```bash
pytest
```
---
## Deployment
The application is continuously deployed via Streamlit Cloud using GitHub Actions.
- Pushes to `main` trigger the CI workflow.
- CI runs unit tests and lints code before deployment.
- Streamlit Cloud automatically rebuilds the app environment based on `requirements.txt` and `runtime.txt`.
---
## License
This repository is distributed under the MIT License. See the LICENSE file for details.
