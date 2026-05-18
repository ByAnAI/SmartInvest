"""
3-state Gaussian HMM on daily commodity OHLC (RSI + MACD features).
Separate cache from forex pairs: ``backend/cache/hmm_commodity_{ID}.pkl``.
"""

from __future__ import annotations

import pickle
from pathlib import Path

import numpy as np
import pandas as pd
from hmmlearn.hmm import GaussianHMM

from commodity_registry import normalize_commodity_id
from forex_technicals import build_feature_frame, load_ohlc_csv
from hmm_cache_util import load_hmm_pickle

_CACHE: dict[str, tuple[GaussianHMM, np.ndarray, dict[int, int], np.ndarray]] = {}


def _cache_path(commodity_id: str) -> Path:
    d = Path(__file__).resolve().parent / "cache"
    d.mkdir(parents=True, exist_ok=True)
    return d / f"hmm_commodity_{commodity_id.upper()}.pkl"


def _scale_features(rsi: pd.Series, macd: pd.Series) -> np.ndarray:
    rsi_n = (rsi / 100.0).clip(0, 1).values.reshape(-1, 1)
    m = macd.values
    q1, q3 = np.nanpercentile(m, [25, 75])
    iqr = max(q3 - q1, 1e-9)
    macd_n = (m / (iqr * 4)).clip(-3, 3).reshape(-1, 1)
    return np.hstack([rsi_n, macd_n])


def _remap_states_by_return(
    model: GaussianHMM,
    X: np.ndarray,
    log_ret: np.ndarray,
) -> dict[int, int]:
    labels = model.predict(X)
    means = []
    for k in range(model.n_components):
        mask = labels == k
        if mask.sum() < 5:
            means.append((k, np.nanmean(log_ret[mask])))
        else:
            means.append((k, float(np.nanmean(log_ret[mask]))))
    means.sort(key=lambda x: (x[1] if np.isfinite(x[1]) else 0.0))
    return {old: new for new, (old, _) in enumerate(means)}


def train_or_load_commodity(
    commodity_id: str,
    csv_path: Path,
    *,
    n_components: int = 3,
    random_state: int = 42,
    min_rows: int = 120,
) -> tuple[GaussianHMM, np.ndarray, dict[int, int], np.ndarray]:
    """Returns model, feature matrix X, state remap, and log_ret array aligned to X."""
    cid = normalize_commodity_id(commodity_id)
    if cid in _CACHE:
        return _CACHE[cid]  # type: ignore[return-value]

    cp = _cache_path(cid)
    payload = load_hmm_pickle(cp)
    if payload is not None:
        _CACHE[cid] = payload
        return payload

    df = load_ohlc_csv(csv_path)
    feat = build_feature_frame(df)
    if len(feat) < min_rows:
        raise ValueError(
            f"Not enough daily rows for commodity HMM ({len(feat)} < {min_rows}). "
            "Run npm run download:commodities:5y first."
        )

    rsi = feat["rsi"]
    macd = feat["macd"]
    X = _scale_features(rsi, macd)
    log_ret = feat["log_ret"].values

    model = GaussianHMM(
        n_components=n_components,
        covariance_type="full",
        n_iter=300,
        random_state=random_state,
        tol=1e-3,
    )
    model.fit(X)

    remap = _remap_states_by_return(model, X, log_ret)
    payload = (model, X, remap, log_ret)
    _CACHE[cid] = payload
    with open(cp, "wb") as f:
        pickle.dump(payload, f)
    return payload


def predict_commodity_state(
    commodity_id: str,
    csv_path: Path,
) -> tuple[int, list[float], list[float]]:
    model, X, remap, _log_ret = train_or_load_commodity(commodity_id, csv_path)
    last_X = X[-1:]
    raw_state = int(model.predict(last_X)[0])
    mapped = int(remap.get(raw_state, 1))

    proba_raw = model.predict_proba(last_X)[0]
    mapped_proba = [0.0, 0.0, 0.0]
    for old_k, p in enumerate(proba_raw):
        new_label = remap.get(int(old_k), 1)
        if 0 <= new_label <= 2:
            mapped_proba[new_label] += float(p)

    return mapped, mapped_proba, [float(x) for x in proba_raw]


def remapped_transition_matrix(model: GaussianHMM, remap: dict[int, int]) -> np.ndarray:
    n = model.n_components
    T_raw = np.asarray(model.transmat_, dtype=float)
    T = np.zeros((3, 3), dtype=float)
    for i in range(n):
        for j in range(n):
            ni = int(remap.get(i, 1))
            nj = int(remap.get(j, 1))
            T[ni, nj] += T_raw[i, j]
    for k in range(3):
        s = T[k].sum()
        if s > 1e-12:
            T[k] /= s
        else:
            T[k] = 1.0 / 3.0
    return T


def mapped_state_mean_log_returns_from_labels(
    model: GaussianHMM,
    X: np.ndarray,
    remap: dict[int, int],
    log_ret: np.ndarray,
) -> np.ndarray:
    labels = model.predict(X)
    mu = np.zeros(3, dtype=float)
    counts = np.zeros(3, dtype=int)
    for k in range(model.n_components):
        m = int(remap.get(k, 1))
        mask = labels == k
        c = int(mask.sum())
        if c >= 3:
            mu[m] += float(np.nanmean(log_ret[mask])) * c
            counts[m] += c
    for m in range(3):
        if counts[m] > 0:
            mu[m] /= counts[m]
    return mu
