from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import streamlit as st
import pandas as pd
import numpy as np
import plotly.express as px
import plotly.graph_objects as go
from datetime import date, timedelta
import io
import json
import streamlit.components.v1 as components

from portopt.core.risk import (
    portfolio_returns,
    var_cvar_historical,
    rolling_sharpe,
    rolling_sortino,
    corr_matrix,
)
from portopt.core.mc import simulate_gbm_portfolio, summarize_terminal_distribution
from portopt.core.hrp import hrp_weights
from portopt.core.data import fetch_prices, align_and_clean
from portopt.core.stats import (
    annualize_mean_cov,
    shrink_cov_to_diag,
    portfolio_metrics,
    equity_curve,
    drawdown_series,
    ann_return_vol_from_equity,
    max_drawdown,
    bootstrap_sharpe_ci,
)
from portopt.core.opt import (
    trace_efficient_frontier,
    pick_max_sharpe,
    risk_parity_weights,
    solve_cvar_min,
    robust_return_weights,
)
from portopt.core.backtest import backtest_static, backtest_walkforward

# ── Page config (must be first Streamlit call) ──────────────────────────────
st.set_page_config(page_title="PortOpt", page_icon="📈", layout="wide")

# ── Session-state defaults ───────────────────────────────────────────────────
_DEFAULTS = {
    "theme": "Dark",
    "prices": None,
    "rets": None,
    "frontier": None,
    "best_idx": None,
    "weights": None,
    "weights_labels": None,
    "template_name": "Custom",
    "template_tickers": "AAPL, MSFT, TLT, GLD, IWM, SPY",
    "template_long_only": True,
    "template_lb": 0.0,
    "template_ub": 0.60,
    "perf_mode": "Balanced",
}
for k, v in _DEFAULTS.items():
    if k not in st.session_state:
        st.session_state[k] = v

# ── Constants ────────────────────────────────────────────────────────────────
TEMPLATE_NAMES = ["Custom", "Aggressive Growth", "Conservative Income", "All Weather"]

TEMPLATE_CONFIG = {
    "Aggressive Growth": dict(tickers="AAPL, MSFT, NVDA, TSLA, AMZN, QQQ", long_only=True, lb=0.0, ub=0.40),
    "Conservative Income": dict(tickers="TLT, IEF, LQD, GLD, SHY",         long_only=True, lb=0.0, ub=0.35),
    "All Weather":         dict(tickers="SPY, TLT, IEF, GLD, DBC",          long_only=True, lb=0.0, ub=0.40),
    "Custom":              dict(tickers="AAPL, MSFT, TLT, GLD, IWM, SPY",   long_only=True, lb=0.0, ub=0.60),
}

PPY_MAP = {"Daily": 252, "Weekly": 52, "Monthly": 12}


# ── Helper functions ─────────────────────────────────────────────────────────

def periods_per_year(freq: str) -> int:
    return PPY_MAP[freq]


def apply_template(name: str) -> None:
    cfg = TEMPLATE_CONFIG.get(name, TEMPLATE_CONFIG["Custom"])
    st.session_state.template_tickers   = cfg["tickers"]
    st.session_state.template_long_only = cfg["long_only"]
    st.session_state.template_lb        = cfg["lb"]
    st.session_state.template_ub        = cfg["ub"]


def compute_returns(prices: pd.DataFrame, method: str = "Log") -> pd.DataFrame:
    if method == "Log":
        rets = np.log(prices / prices.shift(1))
    else:
        rets = prices.pct_change()
    return rets.dropna()


@st.cache_data(show_spinner=False)
def cached_fetch(tickers: tuple, start, end, interval: str) -> pd.DataFrame:
    if not tickers:
        raise ValueError("No tickers provided.")
    raw    = fetch_prices(list(tickers), start=start, end=end, interval=interval)
    prices = align_and_clean(raw)
    if prices.empty:
        raise ValueError(
            "Downloaded prices are empty. Try Daily frequency, widen the date range, "
            "and verify tickers (e.g. AAPL, MSFT, TLT, GLD, IWM, SPY)."
        )
    return prices


def animated_metric(label: str, value: float, key: str, fmt: str = "{:.4f}") -> None:
    """Count-up animated metric card."""
    if value is None or (isinstance(value, float) and np.isnan(value)):
        display_val = "—"
        js_val = 0.0
    else:
        display_val = fmt.format(value)
        js_val = float(value)

    cid = f"metric-{key}"
    st.markdown(
        f"""
        <div id="{cid}" class="animated-metric">
            <div class="metric-label">{label}</div>
            <div class="metric-value"
                 data-target="{js_val}"
                 data-display="{display_val}">…</div>
        </div>
        <script>
        (function(){{
            const el = document.getElementById("{cid}");
            if (!el) return;
            const v  = el.querySelector(".metric-value");
            if (!v)  return;
            if (v.dataset.animated) {{ v.textContent = v.dataset.display; return; }}
            v.dataset.animated = "1";
            const target  = parseFloat(v.dataset.target);
            const display = v.dataset.display;
            if (!isFinite(target)) {{ v.textContent = display; return; }}
            const isPct = display.includes("%");
            const dec   = (display.replace("%","").split(".")[1] || "").length;
            const dur   = 700, t0 = performance.now();
            const ease  = t => t*(2-t);
            (function tick(now){{
                const p = Math.min((now - t0) / dur, 1);
                v.textContent = (target * ease(p)).toFixed(dec) + (isPct ? "%" : "");
                if (p < 1) requestAnimationFrame(tick);
                else v.textContent = display;
            }})(t0);
        }})();
        </script>
        """,
        unsafe_allow_html=True,
    )


def render_correlation_globe(corr: pd.DataFrame) -> None:
    if corr is None or corr.empty or corr.shape[0] < 2:
        st.info("Need at least 2 assets to render the globe.")
        return
    payload = json.dumps({"labels": list(corr.columns), "matrix": corr.values.tolist()})
    html = f"""
    <div id="corr-globe" style="width:100%;height:480px;"></div>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>
    <script>
    (function(){{
      const data = {payload};
      const el   = document.getElementById("corr-globe");
      if (!el) return;
      const scene    = new THREE.Scene();
      const camera   = new THREE.PerspectiveCamera(50, el.clientWidth/el.clientHeight, 0.1, 1000);
      const renderer = new THREE.WebGLRenderer({{antialias:true, alpha:true}});
      renderer.setSize(el.clientWidth, el.clientHeight);
      el.innerHTML = "";
      el.appendChild(renderer.domElement);
      scene.add(new THREE.AmbientLight(0xffffff, 0.7));
      const dir = new THREE.DirectionalLight(0xffffff, 0.5);
      dir.position.set(5,8,10); scene.add(dir);
      const R=3, geo=new THREE.SphereGeometry(0.12,24,24), nodes=[];
      const n=data.labels.length;
      for(let i=0;i<n;i++){{
        const phi=Math.acos(1-2*(i+0.5)/n), th=Math.PI*(1+Math.sqrt(5))*i;
        const mat=new THREE.MeshStandardMaterial({{color:0x60a5fa,emissive:0x1d4ed8,metalness:0.6,roughness:0.25}});
        const m=new THREE.Mesh(geo,mat);
        m.position.set(R*Math.cos(th)*Math.sin(phi),R*Math.sin(th)*Math.sin(phi),R*Math.cos(phi));
        scene.add(m); nodes.push(m);
      }}
      const matP=new THREE.LineBasicMaterial({{color:0x22c55e,transparent:true}});
      const matN=new THREE.LineBasicMaterial({{color:0xef4444,transparent:true}});
      for(let i=0;i<n;i++) for(let j=i+1;j<n;j++){{
        const c=data.matrix[i][j];
        if(!isFinite(c)||Math.abs(c)<0.25) continue;
        const pts=[nodes[i].position.clone(),nodes[j].position.clone()];
        const g=new THREE.BufferGeometry().setFromPoints(pts);
        const m=(c>=0?matP:matN).clone(); m.opacity=0.15+0.6*Math.abs(c);
        scene.add(new THREE.Line(g,m));
      }}
      camera.position.z=9;
      let ang=0;
      (function loop(){{ requestAnimationFrame(loop); ang+=0.003; scene.rotation.y=ang; renderer.render(scene,camera); }})();
      window.addEventListener("resize",()=>{{
        const w=el.clientWidth,h=el.clientHeight;
        if(w>0&&h>0){{ camera.aspect=w/h; camera.updateProjectionMatrix(); renderer.setSize(w,h); }}
      }});
    }})();
    </script>
    """
    components.html(html, height=500)


def inject_css(theme: str = "Dark") -> None:
    dark = theme == "Dark"
    bg        = "#0d1117" if dark else "#f5f2ec"
    card_bg   = "rgba(22,27,34,0.90)"   if dark else "rgba(255,255,255,0.88)"
    border    = "rgba(48,54,61,0.9)"    if dark else "rgba(212,207,198,0.9)"
    text      = "#c9d1d9"               if dark else "#24292f"
    muted     = "#8b949e"               if dark else "#7a756c"
    metric_bg = "rgba(22,27,34,0.85)"   if dark else "rgba(246,248,250,0.9)"
    accent    = "#2f81f7"               if dark else "#0969da"

    st.markdown(f"""
    <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap');

    html, body, [data-testid="stAppViewContainer"] > .main {{
        background: {bg} !important;
        color: {text} !important;
        font-family: 'Inter', sans-serif;
    }}
    header {{ background: transparent !important; }}

    /* ── Sidebar ── */
    [data-testid="stSidebar"] {{
        background: {"#0d1117" if dark else "#f0ede6"} !important;
        border-right: 1px solid {border} !important;
    }}
    [data-testid="stSidebar"] * {{ font-size: 13px !important; }}

    /* ── Cards ── */
    .glass-card {{
        background: {card_bg};
        border: 1px solid {border};
        border-radius: 8px;
        padding: 1.2rem 1.4rem;
        margin-bottom: 1.2rem;
        backdrop-filter: blur(12px);
    }}

    /* ── Metrics ── */
    .animated-metric {{
        background: {metric_bg};
        border: 1px solid {border};
        border-radius: 8px;
        padding: 1rem 1.2rem;
        display: flex;
        flex-direction: column;
        gap: 4px;
    }}
    .metric-label {{
        font-family: 'JetBrains Mono', monospace;
        font-size: 10px;
        letter-spacing: 0.1em;
        text-transform: uppercase;
        color: {muted};
    }}
    .metric-value {{
        font-family: 'JetBrains Mono', monospace;
        font-size: 1.6rem;
        font-weight: 600;
        color: {text};
        letter-spacing: -0.02em;
    }}

    /* ── Tabs ── */
    [data-testid="stTabs"] button {{
        font-size: 12px !important;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        font-family: 'JetBrains Mono', monospace !important;
    }}
    [data-testid="stTabs"] button[aria-selected="true"] {{
        color: {accent} !important;
        border-bottom-color: {accent} !important;
    }}

    /* ── Tables ── */
    [data-testid="stDataFrame"] table {{
        font-family: 'JetBrains Mono', monospace !important;
        font-size: 12px !important;
    }}

    /* ── Skeleton ── */
    .skeleton-card {{
        height: 120px;
        border-radius: 8px;
        border: 1px solid {border};
        background: linear-gradient(90deg, {bg} 0%, {"#21262d" if dark else "#e8e4dc"} 50%, {bg} 100%);
        background-size: 200% 100%;
        animation: shimmer 1.4s linear infinite;
        margin-bottom: 1rem;
    }}
    @keyframes shimmer {{
        0%   {{ background-position: -200% 0; }}
        100% {{ background-position:  200% 0; }}
    }}

    /* ── Pulse ── */
    @keyframes pulse-ring {{
        0%   {{ box-shadow: 0 0 0 0   rgba(47,129,247,0.4); }}
        70%  {{ box-shadow: 0 0 0 10px rgba(47,129,247,0);   }}
        100% {{ box-shadow: 0 0 0 0   rgba(47,129,247,0);   }}
    }}
    .pulse-highlight {{ animation: pulse-ring 2s infinite; border-radius: 8px; }}

    /* ── Status chips ── */
    .status-chip {{
        display: inline-flex;
        align-items: center;
        padding: 3px 10px;
        border-radius: 999px;
        border: 1px solid {border};
        font-family: 'JetBrains Mono', monospace;
        font-size: 10px;
        letter-spacing: 0.1em;
        text-transform: uppercase;
        color: {muted};
        background: {bg};
    }}
    .status-chip-primary {{
        border-color: {accent};
        color: {accent};
    }}

    /* ── Top shell bar ── */
    .top-shell {{
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 6px 16px;
        margin-bottom: 8px;
        border: 1px solid {border};
        border-radius: 6px;
        background: {"rgba(13,17,23,0.8)" if dark else "rgba(240,237,230,0.8)"};
        font-family: 'JetBrains Mono', monospace;
        font-size: 11px;
        letter-spacing: 0.08em;
    }}
    .shell-left, .shell-right {{ display: flex; align-items: center; gap: 8px; color: {muted}; }}
    .shell-label {{ opacity: 0.6; text-transform: uppercase; }}
    .shell-value {{ font-weight: 600; color: {text}; }}
    .shell-sep   {{ opacity: 0.3; }}
    .shell-pill  {{
        padding: 2px 8px;
        border-radius: 999px;
        font-size: 10px;
        font-weight: 600;
        letter-spacing: 0.12em;
        border: 1px solid rgba(48,54,61,0.9);
    }}
    .shell-pill-live {{
        background: #22c55e22;
        border-color: #22c55e88;
        color: #22c55e;
    }}

    /* ── Plotly ── */
    .js-plotly-plot .plotly {{ border-radius: 6px; }}

    *:focus {{ outline: none !important; box-shadow: none !important; }}
    </style>
    """, unsafe_allow_html=True)


# ── Template init ────────────────────────────────────────────────────────────
if st.session_state.template_name not in TEMPLATE_CONFIG:
    st.session_state.template_name = "Custom"
    apply_template("Custom")

# ── Sidebar ──────────────────────────────────────────────────────────────────
with st.sidebar:
    theme = st.radio("Theme", ["Dark", "Light"],
                     index=0 if st.session_state.theme == "Dark" else 1,
                     horizontal=True)
    st.session_state.theme = theme

    st.header("Data")
    template = st.selectbox("Portfolio template", TEMPLATE_NAMES,
                             index=TEMPLATE_NAMES.index(st.session_state.template_name))
    if template != st.session_state.template_name:
        st.session_state.template_name = template
        apply_template(template)

    tickers_text = st.text_input("Tickers", value=st.session_state.template_tickers, key="tickers_input")
    end_date     = st.date_input("End date",   value=date.today())
    start_date   = st.date_input("Start date", value=date.today() - timedelta(days=365 * 5))
    freq         = st.selectbox("Data frequency", ["Daily", "Weekly", "Monthly"])
    ret_method   = st.selectbox("Return model", ["Log", "Simple"])
    load_btn     = st.button("Load data", type="primary")

    st.header("Optimization")
    rf        = st.number_input("Risk-free rate (annual)", value=0.03, format="%.4f")
    long_only = st.checkbox("Long only", value=st.session_state.template_long_only)
    lb        = st.number_input("Lower weight bound", value=st.session_state.template_lb,
                                min_value=-1.0, max_value=1.0, step=0.05)
    ub        = st.number_input("Upper weight bound", value=st.session_state.template_ub,
                                min_value=0.0,  max_value=1.0, step=0.05)
    alpha     = st.slider("Covariance shrinkage α", 0.0, 1.0, 0.1, 0.05)
    n_pts     = st.slider("Frontier points", 10, 60, 25, 1)

    solve_btn     = st.button("Solve frontier")
    hrp_btn       = st.button("Compute HRP weights")
    rp_btn        = st.button("Compute risk-parity weights")
    cvar_btn      = st.button("Minimize CVaR portfolio")
    robust_gamma  = st.slider("Robustness γ", 0.0, 5.0, 1.0, 0.1)
    robust_btn    = st.button("Compute robust portfolio")

    st.header("Performance")
    perf_mode = st.radio("Detail level", ["Balanced", "Max detail"], index=0,
                         help="Balanced: heavy charts are opt-in. Max detail: everything on.")
    st.session_state.perf_mode = perf_mode

# ── CSS injection ─────────────────────────────────────────────────────────────
inject_css(st.session_state.theme)

# ── Top shell bar ─────────────────────────────────────────────────────────────
st.markdown(f"""
<div class="top-shell">
    <div class="shell-left">
        <span class="shell-pill shell-pill-live">LIVE</span>
        <span class="shell-label">ENV</span><span class="shell-value">PortOpt</span>
        <span class="shell-sep">·</span>
        <span class="shell-label">RF</span><span class="shell-value">{rf*100:.1f}%</span>
    </div>
    <div class="shell-right">
        <span class="shell-label">Mode</span>
        <span class="shell-value">{perf_mode}</span>
    </div>
</div>
""", unsafe_allow_html=True)

# ── Page title ────────────────────────────────────────────────────────────────
st.title("Portfolio Optimization")
st.caption("Markowitz · HRP · CVaR · Risk Parity · Robust MVO — backtests and risk analytics.")

# ── Hero metrics (only shown once weights are computed) ───────────────────────
if st.session_state.rets is not None and st.session_state.weights is not None:
    _rets    = st.session_state.rets
    _weights = st.session_state.weights
    _ppy     = periods_per_year(freq)
    _ps      = portfolio_returns(_rets, _weights)
    _eq      = equity_curve(_ps)
    _ar, _av = ann_return_vol_from_equity(_eq, _ppy)
    _sh      = (_ar - rf) / _av if _av and _av > 0 else np.nan
    _mdd     = max_drawdown(_eq)

    c1, c2, c3, c4 = st.columns(4)
    with c1: animated_metric("Total equity",    float(_eq.iloc[-1]),  key="h-eq",  fmt="{:.2f}")
    with c2: animated_metric("Annual return",   float(_ar * 100),     key="h-ret", fmt="{:.2f}%")
    with c3: animated_metric("Sharpe ratio",    float(_sh),           key="h-sh",  fmt="{:.2f}")
    with c4: animated_metric("Max drawdown",    float(_mdd * 100),    key="h-mdd", fmt="{:.1f}%")

    st.markdown("---")

# ── Tickers ───────────────────────────────────────────────────────────────────
tickers = tuple(t.strip().upper() for t in tickers_text.split(",") if t.strip())

# ── Load data ─────────────────────────────────────────────────────────────────
if load_btn:
    if not tickers:
        st.error("Please enter at least one ticker.")
    else:
        with st.spinner("Fetching prices…"):
            try:
                prices = cached_fetch(tickers, start_date, end_date, freq)
                rets   = compute_returns(prices, method=ret_method)
                st.session_state.prices = prices
                st.session_state.rets   = rets
                # reset downstream state when new data is loaded
                st.session_state.frontier      = None
                st.session_state.weights       = None
                st.session_state.weights_labels = None
                st.success(f"✓ Loaded {len(prices.columns)} tickers · {len(prices)} rows · "
                           f"{prices.index[0].date()} → {prices.index[-1].date()}")
            except Exception as e:
                st.error(f"Failed to load data: {e}")

# ── Tabs ──────────────────────────────────────────────────────────────────────
tabs = st.tabs(["Prices", "Returns", "Summary", "Optimization", "Backtest", "Risk Analysis", "Downloads"])

# ─────────────────────────────────────────────────────────────────────────────
# TAB 0 — Prices
# ─────────────────────────────────────────────────────────────────────────────
with tabs[0]:
    st.markdown('<div class="glass-card">', unsafe_allow_html=True)
    if st.session_state.prices is None:
        st.info("Load data to see prices.")
    else:
        prices = st.session_state.prices
        st.dataframe(prices.tail(10), use_container_width=True)
        wide = prices.reset_index().melt(id_vars="Date", var_name="Ticker", value_name="Price")
        fig  = px.line(wide, x="Date", y="Price", color="Ticker",
                       title="Adjusted Close Prices", render_mode="webgl")
        fig.update_layout(template="plotly_dark" if st.session_state.theme == "Dark" else "plotly_white",
                          transition_duration=250)
        st.plotly_chart(fig, use_container_width=True)
    st.markdown('</div>', unsafe_allow_html=True)

# ─────────────────────────────────────────────────────────────────────────────
# TAB 1 — Returns
# ─────────────────────────────────────────────────────────────────────────────
with tabs[1]:
    st.markdown('<div class="glass-card">', unsafe_allow_html=True)
    if st.session_state.rets is None:
        st.info("Load data to see returns.")
    else:
        rets     = st.session_state.rets
        ret_wide = rets.reset_index().melt(id_vars="Date", var_name="Ticker", value_name="Return")
        fig2     = px.line(ret_wide, x="Date", y="Return", color="Ticker",
                           title="Periodic Returns", render_mode="webgl")
        fig2.update_layout(template="plotly_dark" if st.session_state.theme == "Dark" else "plotly_white",
                           transition_duration=250)
        st.plotly_chart(fig2, use_container_width=True)
        st.dataframe(rets.tail(10), use_container_width=True)
    st.markdown('</div>', unsafe_allow_html=True)

# ─────────────────────────────────────────────────────────────────────────────
# TAB 2 — Summary
# ─────────────────────────────────────────────────────────────────────────────
with tabs[2]:
    st.markdown('<div class="glass-card">', unsafe_allow_html=True)
    if st.session_state.rets is None:
        st.info("Load data to see summary.")
    else:
        rets       = st.session_state.rets
        ppy        = periods_per_year(freq)
        mu, cov    = annualize_mean_cov(rets, ppy)
        vol        = np.sqrt(np.diag(cov))
        sharpe_ind = (mu - rf) / vol

        df_sum = pd.DataFrame({
            "Ann. Return (%)":   mu * 100,
            "Ann. Vol (%)":      vol * 100,
            "Sharpe":            sharpe_ind,
        }, index=rets.columns)

        def _color_ret(v):
            if pd.isna(v): return ""
            return f"color: {'#22c55e' if v >= 0 else '#ef4444'};"

        st.dataframe(
            df_sum.style
                .format({"Ann. Return (%)": "{:.2f}", "Ann. Vol (%)": "{:.2f}", "Sharpe": "{:.2f}"})
                .applymap(_color_ret, subset=["Ann. Return (%)"])
                .applymap(_color_ret, subset=["Sharpe"]),
            use_container_width=True,
        )

        # Correlation heatmap preview
        corr = corr_matrix(rets)
        fig_c = px.imshow(corr, text_auto=".2f", aspect="auto", title="Return Correlations",
                          color_continuous_scale="RdBu_r", zmin=-1, zmax=1)
        fig_c.update_layout(template="plotly_dark" if st.session_state.theme == "Dark" else "plotly_white")
        st.plotly_chart(fig_c, use_container_width=True)
    st.markdown('</div>', unsafe_allow_html=True)

# ─────────────────────────────────────────────────────────────────────────────
# TAB 3 — Optimization
# ─────────────────────────────────────────────────────────────────────────────
with tabs[3]:
    st.markdown('<div class="glass-card">', unsafe_allow_html=True)
    st.markdown("""
    <div style="display:flex;gap:6px;margin-bottom:12px;">
        <span class="status-chip status-chip-primary">Optimization</span>
        <span class="status-chip">Markowitz · HRP · Risk Parity · CVaR · Robust</span>
    </div>
    """, unsafe_allow_html=True)

    if st.session_state.rets is None:
        st.info("Load data first.")
    else:
        rets = st.session_state.rets
        if rets.empty or rets.shape[1] < 2:
            st.error("Need at least 2 assets with overlapping data.")
        else:
            ppy     = periods_per_year(freq)
            mu, cov = annualize_mean_cov(rets, ppy)

            if mu.size == 0 or np.isnan(mu).any() or np.isnan(cov).any():
                st.error("Invalid mean/covariance — try Daily frequency and a wider date range.")
            else:
                cov_use = shrink_cov_to_diag(cov, alpha=alpha)

                # ── Markowitz frontier ──────────────────────────────────────
                if solve_btn:
                    ph = st.empty()
                    ph.markdown('<div class="skeleton-card"></div>', unsafe_allow_html=True)
                    try:
                        W, targets = trace_efficient_frontier(mu, cov_use, n_pts=n_pts,
                                                              long_only=long_only, lb=lb, ub=ub)
                        risks    = [float(np.sqrt(w @ cov_use @ w)) for w in W]
                        rets_ann = [float(w @ mu) for w in W]
                        sharpes  = [(r-rf)/v if v > 0 else np.nan for r, v in zip(rets_ann, risks)]
                        best_idx, best_sharpe = pick_max_sharpe(mu, cov_use, rf, W)

                        st.session_state.frontier = dict(
                            W=W, risks=risks, rets=rets_ann, sharpes=sharpes,
                            mu=mu, cov=cov_use, best_idx=best_idx,
                            tickers=list(rets.columns), rf=rf, best_sharpe=best_sharpe,
                        )
                        st.session_state.weights        = W[best_idx] if best_idx is not None else None
                        st.session_state.weights_labels = list(rets.columns)
                        ph.empty()
                        st.success(f"Frontier solved — Max Sharpe ≈ {best_sharpe:.2f}")
                    except Exception as e:
                        ph.empty()
                        st.error(f"Optimization failed: {e}")

                # ── HRP ─────────────────────────────────────────────────────
                if hrp_btn:
                    ph = st.empty()
                    ph.markdown('<div class="skeleton-card"></div>', unsafe_allow_html=True)
                    try:
                        w_hrp = hrp_weights(rets)
                        st.session_state.frontier       = None
                        st.session_state.weights        = w_hrp.values
                        st.session_state.weights_labels = list(w_hrp.index)
                        ph.empty()
                        st.success("HRP weights computed.")
                        st.dataframe(w_hrp.to_frame("Weight").style.format("{:.3f}"),
                                     use_container_width=True)
                    except Exception as e:
                        ph.empty(); st.error(f"HRP failed: {e}")

                # ── Risk Parity ──────────────────────────────────────────────
                if rp_btn:
                    ph = st.empty()
                    ph.markdown('<div class="skeleton-card"></div>', unsafe_allow_html=True)
                    try:
                        w_rp = risk_parity_weights(cov_use, lb=lb, ub=ub)
                        st.session_state.frontier       = None
                        st.session_state.weights        = w_rp
                        st.session_state.weights_labels = list(rets.columns)
                        ph.empty()
                        st.success("Risk-parity weights computed.")
                        st.dataframe(pd.Series(w_rp, index=rets.columns)
                                       .to_frame("Weight").style.format("{:.3f}"),
                                     use_container_width=True)
                    except Exception as e:
                        ph.empty(); st.error(f"Risk parity failed: {e}")

                # ── CVaR ─────────────────────────────────────────────────────
                if cvar_btn:
                    ph = st.empty()
                    ph.markdown('<div class="skeleton-card"></div>', unsafe_allow_html=True)
                    try:
                        w_cv = solve_cvar_min(returns=rets.to_numpy(), alpha=0.95,
                                              long_only=long_only, lb=lb, ub=ub)
                        st.session_state.frontier       = None
                        st.session_state.weights        = w_cv
                        st.session_state.weights_labels = list(rets.columns)
                        ph.empty()
                        st.success("CVaR-minimizing weights computed.")
                        st.dataframe(pd.Series(w_cv, index=rets.columns)
                                       .to_frame("Weight").style.format("{:.3f}"),
                                     use_container_width=True)
                        pr_cv = (rets * w_cv).sum(axis=1)
                        vv, cv = var_cvar_historical(pr_cv, alpha=0.95)
                        st.info(f"Historical VaR (95%): {vv:.4f}   CVaR (95%): {cv:.4f}")
                    except Exception as e:
                        ph.empty(); st.error(f"CVaR failed: {e}")

                # ── Robust MVO ───────────────────────────────────────────────
                if robust_btn:
                    ph = st.empty()
                    ph.markdown('<div class="skeleton-card"></div>', unsafe_allow_html=True)
                    try:
                        w_rob = robust_return_weights(mu=mu, cov=cov_use, gamma=float(robust_gamma),
                                                      long_only=long_only, lb=lb, ub=ub)
                        st.session_state.frontier       = None
                        st.session_state.weights        = w_rob
                        st.session_state.weights_labels = list(rets.columns)
                        ph.empty()
                        st.success("Robust portfolio weights computed.")
                        st.dataframe(pd.Series(w_rob, index=rets.columns)
                                       .to_frame("Weight").style.format("{:.3f}"),
                                     use_container_width=True)
                        nom_ret   = float(w_rob @ mu)
                        ev, evec  = np.linalg.eigh(cov_use)
                        sqrt_cov  = evec @ np.diag(np.sqrt(np.clip(ev, 0, None))) @ evec.T
                        unc       = float(np.linalg.norm(sqrt_cov @ w_rob))
                        wc_ret    = nom_ret - float(robust_gamma) * unc
                        st.info(f"Nominal return: {nom_ret:.3f}  |  "
                                f"Uncertainty: {unc:.3f}  |  "
                                f"Worst-case return: {wc_ret:.3f}")
                    except Exception as e:
                        ph.empty(); st.error(f"Robust optimization failed: {e}")

                # ── Render frontier ──────────────────────────────────────────
                f = st.session_state.frontier
                if f is not None:
                    colA, colB = st.columns([2, 1])
                    with colA:
                        fig_f = go.Figure()
                        fig_f.add_trace(go.Scatter(
                            x=f["risks"], y=f["rets"],
                            mode="lines+markers", name="Frontier",
                            line=dict(color="#2f81f7", width=2),
                            marker=dict(size=5),
                        ))
                        if f["best_idx"] is not None:
                            i = f["best_idx"]
                            fig_f.add_trace(go.Scatter(
                                x=[f["risks"][i]], y=[f["rets"][i]],
                                mode="markers",
                                marker=dict(size=14, symbol="star", color="#f78166"),
                                name=f"Max Sharpe ({f['best_sharpe']:.2f})",
                            ))
                        fig_f.update_layout(
                            title="Efficient Frontier",
                            xaxis_title="Annual Volatility",
                            yaxis_title="Annual Return",
                            template="plotly_dark" if st.session_state.theme == "Dark" else "plotly_white",
                            transition_duration=200,
                        )
                        st.plotly_chart(fig_f, use_container_width=True)

                        if st.session_state.weights is not None:
                            w_series = pd.Series(st.session_state.weights,
                                                 index=f["tickers"], name="Weight")
                            st.subheader("Max Sharpe Weights")
                            st.markdown('<div class="pulse-highlight">', unsafe_allow_html=True)
                            st.dataframe(w_series.to_frame().style.format("{:.3f}"),
                                         use_container_width=True)
                            st.markdown('</div>', unsafe_allow_html=True)
                            mets = portfolio_metrics(st.session_state.weights,
                                                     f["mu"], f["cov"], rf=f["rf"])
                            c1, c2, c3 = st.columns(3)
                            with c1: animated_metric("Return", mets["return"]*100, key="opt-ret", fmt="{:.2f}%")
                            with c2: animated_metric("Volatility", mets["vol"]*100, key="opt-vol", fmt="{:.2f}%")
                            with c3: animated_metric("Sharpe", mets["sharpe"], key="opt-sh",  fmt="{:.2f}")

                        if f.get("sharpes") and st.checkbox("Show 3-D frontier", value=False):
                            df3d = pd.DataFrame({"Volatility": f["risks"],
                                                 "Return": f["rets"],
                                                 "Sharpe": f["sharpes"]})
                            fig3d = px.scatter_3d(df3d, x="Volatility", y="Return", z="Sharpe",
                                                  color="Sharpe", title="3-D Efficient Frontier")
                            fig3d.update_traces(marker=dict(size=4))
                            st.plotly_chart(fig3d, use_container_width=True)

                    with colB:
                        st.markdown("**Tips**")
                        st.caption("• Use Daily data + 5-year window for best overlap")
                        st.caption("• Increase shrinkage α if frontier looks unstable")
                        st.caption("• Widen upper bound to avoid corner solutions")
                else:
                    st.info("Configure options in the sidebar and click **Solve frontier**.")
    st.markdown('</div>', unsafe_allow_html=True)

# ─────────────────────────────────────────────────────────────────────────────
# TAB 4 — Backtest
# ─────────────────────────────────────────────────────────────────────────────
with tabs[4]:
    st.markdown('<div class="glass-card">', unsafe_allow_html=True)
    if st.session_state.rets is None or st.session_state.weights is None:
        st.info("Solve the frontier or compute weights first.")
    else:
        prices  = st.session_state.prices
        rets    = st.session_state.rets
        weights = st.session_state.weights
        ppy     = periods_per_year(freq)
        bt      = None

        mode = st.radio("Backtest mode", ["Static weights", "Walk-forward"], horizontal=True)

        if mode == "Static weights":
            if st.button("Run static backtest", key="run-static-bt"):
                with st.spinner("Running…"):
                    try:
                        bt = backtest_static(prices, rets, weights,
                                             include_equal_weight=True, market_proxy="SPY")
                        st.session_state["_bt"] = bt
                    except Exception as e:
                        st.error(f"Static backtest failed: {e}")
        else:
            col1, col2, col3, col4 = st.columns(4)
            with col1: window   = st.slider("Training window", 60, 756, 252, 21)
            with col2: step     = st.slider("Rebalance every N", 5, 63, 21, 1)
            with col3: tc_bps   = st.slider("Transaction cost (bps)", 0.0, 50.0, 5.0, 0.5)
            with col4: slip_bps = st.slider("Slippage (bps)", 0.0, 50.0, 2.0, 0.5)

            if st.button("Run walk-forward backtest", key="run-walk-bt"):
                ph = st.empty()
                ph.markdown('<div class="skeleton-card"></div>', unsafe_allow_html=True)
                try:
                    bt = backtest_walkforward(
                        prices=prices, returns=rets, rf=rf, ppy=ppy,
                        window=window, step=step,
                        tc_bps=tc_bps/10000, slippage_bps=slip_bps/10000,
                        long_only=long_only, lb=lb, ub=ub,
                        alpha=alpha, n_pts=n_pts,
                        include_equal_weight=True, market_proxy="SPY",
                    )
                    st.session_state["_bt"] = bt
                    ph.empty()
                    st.success("Walk-forward backtest completed.")
                except Exception as e:
                    ph.empty()
                    st.error(f"Walk-forward backtest failed: {e}")

        # use cached backtest result across reruns
        bt = st.session_state.get("_bt", None)

        if bt is not None:
            # ── Extra benchmarks ──────────────────────────────────────────────
            def _add_benchmark(name, key, r_series):
                try:
                    eq = equity_curve(r_series.dropna())
                    bt[key]       = eq
                    bt[key + "DD"] = drawdown_series(eq)
                except Exception:
                    pass

            if {"SPY", "TLT"}.issubset(prices.columns):
                idx = prices["SPY"].pct_change().dropna().index.intersection(
                      prices["TLT"].pct_change().dropna().index)
                if len(idx) > 1:
                    _add_benchmark("60/40", "B60_40",
                                   0.6*prices["SPY"].pct_change().loc[idx] +
                                   0.4*prices["TLT"].pct_change().loc[idx])

            aw_spec = [("SPY",0.30),("TLT",0.40),("IEF",0.15),("GLD",0.075),("DBC",0.075)]
            avail   = [(t,w) for t,w in aw_spec if t in prices.columns]
            if len(avail) >= 2:
                tw = sum(w for _,w in avail)
                avail = [(t,w/tw) for t,w in avail]
                idx_aw = prices[avail[0][0]].pct_change().dropna().index
                for t,_ in avail[1:]:
                    idx_aw = idx_aw.intersection(prices[t].pct_change().dropna().index)
                if len(idx_aw) > 1:
                    r_aw = sum(w*prices[t].pct_change().loc[idx_aw] for t,w in avail)
                    _add_benchmark("All Weather", "AllWeather", r_aw)

            # ── IS / OOS split ────────────────────────────────────────────────
            split_idx = None
            if isinstance(bt.get("Portfolio"), pd.Series) and len(bt["Portfolio"]) > 1:
                st.markdown("### In-sample / Out-of-sample split")
                frac      = st.slider("OOS starts at fraction", 0.2, 0.9, 0.7, 0.05)
                eq_idx    = bt["Portfolio"].index
                pos       = min(max(int(len(eq_idx)*frac), 1), len(eq_idx)-1)
                split_idx = eq_idx[pos]
                st.caption(f"OOS starts at **{split_idx.date()}** (≈ {int(frac*100)}% in)")

            # ── Equity curves ─────────────────────────────────────────────────
            BENCH_KEYS = [("Portfolio","Portfolio"), ("EqualWeight","EqualWeight"),
                          ("Market","Market"), ("B60_40","60/40"), ("AllWeather","All Weather")]

            def _series_list(keys):
                out = []
                for key, label in keys:
                    if isinstance(bt.get(key), pd.Series):
                        s = pd.to_numeric(bt[key], errors="coerce")
                        s.name = label
                        out.append(s)
                return out

            eq_parts = _series_list(BENCH_KEYS)
            if eq_parts:
                eq_df   = pd.concat(eq_parts, axis=1).astype(float)
                eq_long = eq_df.reset_index().melt(id_vars="Date", var_name="Strategy", value_name="Equity")
                fig_eq  = px.line(eq_long, x="Date", y="Equity", color="Strategy",
                                  title="Equity Curve (normalised to 1.0)", render_mode="webgl")
                if split_idx is not None:
                    fig_eq.add_vline(x=split_idx, line_dash="dash", line_width=1, line_color="gray")
                fig_eq.update_layout(template="plotly_dark" if st.session_state.theme == "Dark" else "plotly_white")
                st.plotly_chart(fig_eq, use_container_width=True)

            dd_parts = _series_list([(k+"DD", l+" DD") for k, l in BENCH_KEYS])
            if dd_parts:
                dd_df   = pd.concat(dd_parts, axis=1).astype(float)
                dd_long = dd_df.reset_index().melt(id_vars="Date", var_name="Strategy", value_name="Drawdown")
                fig_dd  = px.line(dd_long, x="Date", y="Drawdown", color="Strategy",
                                  title="Drawdown", render_mode="webgl")
                if split_idx is not None:
                    fig_dd.add_vline(x=split_idx, line_dash="dash", line_width=1, line_color="gray")
                fig_dd.update_layout(template="plotly_dark" if st.session_state.theme == "Dark" else "plotly_white")
                st.plotly_chart(fig_dd, use_container_width=True)

            # ── Summary metrics table ─────────────────────────────────────────
            st.subheader("Backtest metrics")
            rows = []
            for key, label in BENCH_KEYS:
                if isinstance(bt.get(key), pd.Series):
                    ar, av = ann_return_vol_from_equity(bt[key], ppy)
                    dd     = max_drawdown(bt[key])
                    sh     = (ar-rf)/av if av > 0 else np.nan
                    rows.append({"Strategy": label, "Ann Return": ar,
                                 "Ann Vol": av, "Sharpe": sh, "Max DD": dd})
            if rows:
                st.dataframe(
                    pd.DataFrame(rows).style.format(
                        {"Ann Return":"{:.2%}", "Ann Vol":"{:.2%}",
                         "Sharpe":"{:.2f}", "Max DD":"{:.2%}"}),
                    use_container_width=True)

            # ── IS/OOS segment metrics ────────────────────────────────────────
            if split_idx is not None:
                st.subheader("Metrics by segment (IS / OOS)")
                seg_rows = []
                for key, label in BENCH_KEYS:
                    if not isinstance(bt.get(key), pd.Series): continue
                    for seg, eq_seg in [("IS",  bt[key][bt[key].index <= split_idx]),
                                        ("OOS", bt[key][bt[key].index >  split_idx])]:
                        if len(eq_seg) < 2: continue
                        ar, av = ann_return_vol_from_equity(eq_seg, ppy)
                        dd     = max_drawdown(eq_seg)
                        sh     = (ar-rf)/av if av > 0 else np.nan
                        seg_rows.append({"Strategy": label, "Segment": seg,
                                         "Ann Return": ar, "Ann Vol": av,
                                         "Sharpe": sh, "Max DD": dd})
                if seg_rows:
                    st.dataframe(
                        pd.DataFrame(seg_rows).style.format(
                            {"Ann Return":"{:.2%}", "Ann Vol":"{:.2%}",
                             "Sharpe":"{:.2f}", "Max DD":"{:.2%}"}),
                        use_container_width=True)

            # ── Bootstrap Sharpe ──────────────────────────────────────────────
            st.subheader("Sharpe ratio significance (bootstrap)")
            strat_opts = [(l,k) for k,l in BENCH_KEYS if isinstance(bt.get(k), pd.Series)]
            if strat_opts:
                chosen = st.selectbox("Strategy", [l for l,_ in strat_opts])
                key_chosen = next(k for l,k in strat_opts if l == chosen)
                ret_s = bt.get(key_chosen+"R") or bt[key_chosen].pct_change().dropna()

                if len(ret_s) >= 30:
                    run_bs = st.toggle("Run bootstrap (slow)",
                                       value=st.session_state.perf_mode == "Max detail")
                    if run_bs:
                        c1, c2 = st.columns(2)
                        with c1: n_boot    = st.slider("Samples",    500, 5000, 2000, 500)
                        with c2: blk_size  = st.slider("Block size",   5,   63,   21,   2)
                        ph = st.empty()
                        ph.markdown('<div class="skeleton-card"></div>', unsafe_allow_html=True)
                        res = bootstrap_sharpe_ci(ret_s, rf_per_period=rf/ppy,
                                                  n_boot=n_boot, block_size=blk_size,
                                                  ci=0.95, random_state=42)
                        ph.empty()
                        if res.get("samples") is not None and len(res["samples"]) > 0:
                            st.info(f"Sharpe mean = {res['mean']:.2f}  "
                                    f"| 95% CI [{res['ci_lower']:.2f}, {res['ci_upper']:.2f}]")
                            fig_bs = px.histogram(pd.DataFrame({"Sharpe": res["samples"]}),
                                                  x="Sharpe", nbins=40,
                                                  title=f"Bootstrap Sharpe — {chosen}")
                            for x in [res["mean"], res["ci_lower"], res["ci_upper"]]:
                                fig_bs.add_vline(x=x, line_dash="dash", line_width=1)
                            st.plotly_chart(fig_bs, use_container_width=True)
                else:
                    st.info("Not enough data for bootstrap.")

            # ── Sankey rebalancing flows ──────────────────────────────────────
            wh = bt.get("WeightsHistory")
            if isinstance(wh, pd.DataFrame) and wh.shape[0] >= 2:
                st.subheader("Rebalancing flows (Sankey)")
                step_i = st.slider("Rebalance step", 0, wh.shape[0]-2, wh.shape[0]-2)
                w0, w1 = wh.iloc[step_i], wh.iloc[step_i+1]
                tks    = list(wh.columns)
                labels = [f"{t}@t{step_i}" for t in tks] + [f"{t}@t{step_i+1}" for t in tks]
                src, tgt, vals, hover = [], [], [], []
                for idx_t, t in enumerate(tks):
                    delta = float(w1[t] - w0[t])
                    if abs(delta) < 1e-4: continue
                    src.append(idx_t); tgt.append(len(tks)+idx_t)
                    vals.append(abs(delta))
                    hover.append(f"{t}: {float(w0[t]):.3f}→{float(w1[t]):.3f} (Δ{delta:+.3f})")
                if vals:
                    fig_sk = go.Figure(go.Sankey(
                        node=dict(pad=15, thickness=15, label=labels),
                        link=dict(source=src, target=tgt, value=vals,
                                  customdata=hover, hovertemplate="%{customdata}<extra></extra>"),
                    ))
                    fig_sk.update_layout(title="Rebalancing flows",
                                         template="plotly_dark" if st.session_state.theme == "Dark" else "plotly_white")
                    st.plotly_chart(fig_sk, use_container_width=True)

    st.markdown('</div>', unsafe_allow_html=True)

# ─────────────────────────────────────────────────────────────────────────────
# TAB 5 — Risk Analysis
# ─────────────────────────────────────────────────────────────────────────────
with tabs[5]:
    st.markdown('<div class="glass-card">', unsafe_allow_html=True)
    if st.session_state.rets is None or st.session_state.weights is None:
        st.info("Load data and compute weights to enable risk analysis.")
    else:
        prices  = st.session_state.prices
        rets    = st.session_state.rets
        weights = st.session_state.weights
        ppy     = periods_per_year(freq)

        c1, c2, c3, c4 = st.columns(4)
        with c1: alpha_conf    = st.slider("VaR/CVaR confidence", 0.90, 0.99, 0.95, 0.01)
        with c2: horizon_years = st.slider("MC horizon (years)",  0.25, 5.0,  1.0,  0.25)
        with c3: n_paths       = st.slider("MC paths",  100, 2000, 500, 100)
        with c4: roll_window   = st.slider("Rolling window",  30, 252, 126, 10)

        st.markdown("---")
        port_rets  = portfolio_returns(rets, weights)

        # ── VaR / CVaR ────────────────────────────────────────────────────────
        st.subheader("Historical VaR & CVaR")
        var_val, cvar_val = var_cvar_historical(port_rets, alpha=alpha_conf)
        c1, c2, c3 = st.columns(3)
        with c1: animated_metric("VaR",              float(var_val),        key="r-var",  fmt="{:.4f}")
        with c2: animated_metric("CVaR",             float(cvar_val),       key="r-cvar", fmt="{:.4f}")
        with c3: animated_metric("Mean (per period)", float(port_rets.mean()), key="r-mean", fmt="{:.4f}")

        # ── Monte Carlo ───────────────────────────────────────────────────────
        st.markdown("---")
        st.subheader("Monte Carlo simulation")
        mu_ann  = float(port_rets.mean() * ppy)
        vol_ann = float(port_rets.std(ddof=1) * np.sqrt(ppy))

        if np.isnan(mu_ann) or np.isnan(vol_ann) or vol_ann <= 0:
            st.warning("Not enough data to run Monte Carlo.")
        else:
            run_mc = st.toggle("Run Monte Carlo (slow)",
                               value=st.session_state.perf_mode == "Max detail")
            if run_mc:
                with st.spinner("Simulating…"):
                    paths   = simulate_gbm_portfolio(
                        mu_annual=mu_ann, vol_annual=vol_ann,
                        start_value=1.0, years=float(horizon_years),
                        periods_per_year=ppy, n_paths=int(n_paths), random_state=42,
                    )
                    summary = summarize_terminal_distribution(paths)
                    qs      = paths.quantile([0.05,0.25,0.5,0.75,0.95], axis=1).T
                    qs.columns = ["p5","p25","p50","p75","p95"]
                    qs      = qs.reset_index().rename(columns={"index":"step"})

                fig_mc = go.Figure()
                fig_mc.add_trace(go.Scatter(x=qs["step"], y=qs["p50"], mode="lines", name="Median"))
                fig_mc.add_trace(go.Scatter(x=qs["step"], y=qs["p75"], mode="lines", name="75%",
                                            line=dict(width=0.5)))
                fig_mc.add_trace(go.Scatter(x=qs["step"], y=qs["p25"], mode="lines", name="25%",
                                            line=dict(width=0.5), fill="tonexty",
                                            fillcolor="rgba(47,129,247,0.08)"))
                fig_mc.add_trace(go.Scatter(x=qs["step"], y=qs["p95"], mode="lines", name="95%",
                                            line=dict(width=0.5)))
                fig_mc.add_trace(go.Scatter(x=qs["step"], y=qs["p5"],  mode="lines", name="5%",
                                            line=dict(width=0.5), fill="tonexty",
                                            fillcolor="rgba(47,129,247,0.04)"))
                fig_mc.update_layout(
                    title="Monte Carlo — simulated portfolio equity",
                    xaxis_title="Step", yaxis_title="Equity",
                    template="plotly_dark" if st.session_state.theme == "Dark" else "plotly_white",
                )
                st.plotly_chart(fig_mc, use_container_width=True)

                c1,c2,c3,c4 = st.columns(4)
                with c1: animated_metric("Terminal mean",   summary["mean"],   key="mc-m",  fmt="{:.3f}")
                with c2: animated_metric("Terminal median", summary["median"], key="mc-med", fmt="{:.3f}")
                with c3: animated_metric("Terminal 5th %",  summary["p5"],     key="mc-p5",  fmt="{:.3f}")
                with c4: animated_metric("Terminal 95th %", summary["p95"],    key="mc-p95", fmt="{:.3f}")

        # ── Correlation heatmap ───────────────────────────────────────────────
        st.markdown("---")
        st.subheader("Correlation heatmap")
        corr    = corr_matrix(rets)
        fig_cor = px.imshow(corr, text_auto=".2f", aspect="auto",
                            color_continuous_scale="RdBu_r", zmin=-1, zmax=1,
                            title="Asset return correlation")
        fig_cor.update_layout(template="plotly_dark" if st.session_state.theme == "Dark" else "plotly_white")
        st.plotly_chart(fig_cor, use_container_width=True)

        if st.checkbox("Show 3-D correlation globe", value=False):
            render_correlation_globe(corr)

        # ── Rolling Sharpe / Sortino ──────────────────────────────────────────
        st.markdown("---")
        st.subheader("Rolling Sharpe & Sortino")
        roll_sh  = rolling_sharpe(port_rets,  rf_per_period=0.0, window=roll_window)
        roll_so  = rolling_sortino(port_rets, rf_per_period=0.0, window=roll_window)
        roll_df  = pd.DataFrame({"Sharpe": roll_sh, "Sortino": roll_so}).dropna()
        if roll_df.empty:
            st.info("Not enough data for the chosen window size.")
        else:
            roll_df = roll_df.reset_index().rename(columns={"index":"Date"})
            fig_rl  = px.line(roll_df, x="Date", y=["Sharpe","Sortino"],
                              title=f"Rolling Sharpe & Sortino (window={roll_window})",
                              render_mode="webgl")
            fig_rl.update_layout(template="plotly_dark" if st.session_state.theme == "Dark" else "plotly_white")
            st.plotly_chart(fig_rl, use_container_width=True)

        # ── Stress periods ────────────────────────────────────────────────────
        st.markdown("---")
        st.subheader("Historical stress periods")
        STRESS = [
            ("Global Financial Crisis", "2007-10-01", "2009-03-31"),
            ("COVID Crash",             "2020-02-01", "2020-04-30"),
            ("Rate Hike Shock",         "2022-01-01", "2022-12-31"),
        ]
        stress_rows = []
        for name, s, e in STRESS:
            s, e = pd.Timestamp(s), pd.Timestamp(e)
            for label, r_ser in [
                ("Portfolio",   port_rets.loc[s:e]),
                ("Equal Weight", rets.mul(np.ones(rets.shape[1])/rets.shape[1], axis=1).sum(axis=1).loc[s:e]),
            ] + ([("SPY", prices["SPY"].pct_change().loc[s:e])] if "SPY" in prices.columns else []):
                r = r_ser.dropna()
                if r.empty:
                    stress_rows.append({"Period": name, "Strategy": label,
                                        "Cum Return": np.nan, "Max DD": np.nan})
                    continue
                eq_s   = equity_curve(r)
                cum_r  = float(eq_s.iloc[-1] / eq_s.iloc[0] - 1)
                dd_s   = max_drawdown(eq_s)
                stress_rows.append({"Period": name, "Strategy": label,
                                    "Cum Return": cum_r, "Max DD": dd_s})

        if stress_rows:
            sdf = pd.DataFrame(stress_rows)
            st.dataframe(sdf.style.format({"Cum Return":"{:.2%}", "Max DD":"{:.2%}"}),
                         use_container_width=True)
            fig_st = px.bar(sdf.dropna(), x="Period", y="Cum Return", color="Strategy",
                            barmode="group", title="Cumulative return in stress periods")
            fig_st.update_layout(template="plotly_dark" if st.session_state.theme == "Dark" else "plotly_white")
            st.plotly_chart(fig_st, use_container_width=True)

    st.markdown('</div>', unsafe_allow_html=True)

# ─────────────────────────────────────────────────────────────────────────────
# TAB 6 — Downloads
# ─────────────────────────────────────────────────────────────────────────────
with tabs[6]:
    st.markdown('<div class="glass-card">', unsafe_allow_html=True)
    if st.session_state.weights is None:
        st.info("Compute weights first to enable downloads.")
    else:
        labels  = st.session_state.weights_labels or list(st.session_state.rets.columns)
        weights = pd.Series(st.session_state.weights, index=labels, name="Weight")

        st.download_button("⬇ Download weights CSV",
                           data=weights.to_csv().encode(),
                           file_name="portopt_weights.csv", mime="text/csv")

        if st.session_state.frontier:
            f    = st.session_state.frontier
            fcsv = pd.DataFrame({"Volatility": f["risks"], "Return": f["rets"]}).to_csv(index=False)
            st.download_button("⬇ Download frontier CSV",
                               data=fcsv.encode(),
                               file_name="portopt_frontier.csv", mime="text/csv")

        if st.session_state.prices is not None:
            st.download_button("⬇ Download prices CSV",
                               data=st.session_state.prices.to_csv().encode(),
                               file_name="portopt_prices.csv", mime="text/csv")
    st.markdown('</div>', unsafe_allow_html=True)