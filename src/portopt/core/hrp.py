from __future__ import annotations

import numpy as np
import pandas as pd
from scipy.cluster.hierarchy import linkage
from scipy.spatial.distance import squareform


def correl_distance(corr: pd.DataFrame) -> np.ndarray:
    """
    López de Prado distance measure: d_ij = sqrt(0.5 * (1 − corr_ij)).

    Parameters
    ----------
    corr : pd.DataFrame
        Correlation matrix.

    Returns
    -------
    np.ndarray
        Symmetric distance matrix with values in [0, 1].
    """
    clipped = corr.values.clip(-1.0, 1.0)
    return np.sqrt(0.5 * (1.0 - clipped))


def hierarchical_clustering(dist: np.ndarray) -> np.ndarray:
    """
    Single-linkage hierarchical clustering on a distance matrix.

    Parameters
    ----------
    dist : np.ndarray
        Square symmetric distance matrix.

    Returns
    -------
    np.ndarray
        SciPy linkage matrix (shape ``(n-1, 4)``).
    """
    condensed = squareform(dist, checks=False)
    return linkage(condensed, method="single")


def _quasi_diag(link: np.ndarray) -> list[int]:
    """
    Recover the leaf order implied by the linkage matrix (quasi-diagonalisation).

    Uses an iterative stack instead of recursion to avoid hitting Python's
    default recursion limit on large universes.

    Parameters
    ----------
    link : np.ndarray
        SciPy linkage matrix.

    Returns
    -------
    list[int]
        Leaf indices in hierarchical order.
    """
    n        = link.shape[0] + 1          # number of original leaves
    link_int = link[:, :2].astype(int)

    order: list[int] = []
    stack            = [int(link_int[-1, 0]), int(link_int[-1, 1])]

    while stack:
        node = stack.pop()
        if node < n:                       # leaf
            order.append(node)
        else:
            idx = node - n
            # push right then left so left is processed first
            stack.append(int(link_int[idx, 1]))
            stack.append(int(link_int[idx, 0]))

    return order


def _cluster_var(cov_values: np.ndarray, indices: list[int]) -> float:
    """Variance of an equal-weight sub-portfolio."""
    sub = cov_values[np.ix_(indices, indices)]
    w   = np.ones(len(indices)) / len(indices)
    return float(w @ sub @ w)


def _recursive_bisection(cov_values: np.ndarray, sort_ix: list[int]) -> np.ndarray:
    """
    Allocate weights by recursive bisection of the sorted cluster.

    Parameters
    ----------
    cov_values : np.ndarray
        Raw covariance matrix (numpy array, not DataFrame).
    sort_ix : list[int]
        Leaf order from :func:`_quasi_diag`.

    Returns
    -------
    np.ndarray
        Weight array aligned to ``sort_ix`` order.
    """
    weights = np.ones(len(sort_ix))
    # work with index positions into sort_ix
    clusters: list[list[int]] = [list(range(len(sort_ix)))]

    while clusters:
        cluster = clusters.pop()
        if len(cluster) < 2:
            continue

        mid   = len(cluster) // 2
        left  = cluster[:mid]
        right = cluster[mid:]

        left_assets  = [sort_ix[i] for i in left]
        right_assets = [sort_ix[i] for i in right]

        var_l = _cluster_var(cov_values, left_assets)
        var_r = _cluster_var(cov_values, right_assets)
        total = var_l + var_r

        # guard against degenerate case
        alpha = 1.0 - (var_l / total) if total > 0 else 0.5

        weights[left]  *= alpha
        weights[right] *= 1.0 - alpha

        clusters.extend([left, right])

    weights /= weights.sum()
    return weights


def hrp_weights(returns: pd.DataFrame) -> pd.Series:
    """
    Compute Hierarchical Risk Parity weights.

    Full pipeline:
    correlation → distance → single-linkage clustering →
    quasi-diagonalisation → recursive bisection.

    Parameters
    ----------
    returns : pd.DataFrame
        Per-period asset returns, shape (T, N).

    Returns
    -------
    pd.Series
        Portfolio weights indexed by ticker name, summing to 1.

    Raises
    ------
    ValueError
        If fewer than 2 assets are provided.
    """
    if returns.shape[1] < 2:
        raise ValueError("HRP requires at least 2 assets.")

    corr       = returns.corr()
    cov        = returns.cov()
    assets     = list(returns.columns)

    dist       = correl_distance(corr)
    link       = hierarchical_clustering(dist)
    sort_ix    = _quasi_diag(link)
    raw_w      = _recursive_bisection(cov.values, sort_ix)

    # map position → ticker name
    named_w = pd.Series(
        {assets[sort_ix[i]]: raw_w[i] for i in range(len(sort_ix))}
    )
    # return in original column order
    return named_w.reindex(assets)