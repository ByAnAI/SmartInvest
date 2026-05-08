"""
3-state Gaussian HMM on [RSI/100, MACD scaled] only — training and inference use the SAME 2D features.
Sentiment and distance levels are combined in the LLM layer (Forex Sentinel), not inside the HMM.
"""

from __future__ import annotations

import pickle
from pathlib import Path

import numpy as np
import pandas as pd
from hmmlearn.hmm import GaussianHMM

from forex_registry import normalize_forex_pair_symbol
from forex_technicals import build_feature_frame, load_ohlc_csv

# Cache trained models per pair under backend/cache/
_CACHE: dict[str, tuple[GaussianHMM, np.ndarray, dict[int, int]]] = {}


def _repo_root() -> Path:
    return Path(__file__).resolve().parent.parent


def _cache_path(pair: str) -> Path:
    d = Path(__file__).resolve().parent / "cache"
    d.mkdir(parents=True, exist_ok=True)
    return d / f"hmm_{pair.upper()}.pkl"


def _scale_features(rsi: pd.Series, macd: pd.Series) -> np.ndarray:
    """Normalize for numerical stability; MACD scaled by robust IQR."""
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
    """Map raw HMM labels to 0=Bear, 1=Neutral, 2=Bull using mean next-bar log return per state."""
    labels = model.predict(X)
    means = []
    for k in range(model.n_components):
        mask = labels == k
        if mask.sum() < 5:
            means.append((k, np.nanmean(log_ret[mask])))
        else:
            means.append((k, float(np.nanmean(log_ret[mask]))))
    means.sort(key=lambda x: (x[1] if np.isfinite(x[1]) else 0.0))
    # ascending return: bear -> bull
    return {old: new for new, (old, _) in enumerate(means)}


def train_or_load(
    pair: str,
    csv_path: Path,
    n_components: int = 3,
    random_state: int = 42,
) -> tuple[GaussianHMM, np.ndarray, dict[int, int]]:
    pair_u = normalize_forex_pair_symbol(pair)
    if pair_u in _CACHE:
        return _CACHE[pair_u]  # type: ignore[return-value]

    cp = _cache_path(pair_u)
    if cp.exists():
        with open(cp, "rb") as f:
            payload = pickle.load(f)
        _CACHE[pair_u] = payload
        return payload

    df = load_ohlc_csv(csv_path)
    feat = build_feature_frame(df)
    if len(feat) < 200:
        raise ValueError(f"Not enough rows for HMM ({len(feat)}); refresh OHLC CSV first.")

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
    payload = (model, X, remap)
    _CACHE[pair_u] = payload
    with open(cp, "wb") as f:
        pickle.dump(payload, f)
    return payload


def predict_state(
    pair: str,
    csv_path: Path,
) -> tuple[int, list[float], list[float]]:
    """
    Returns:
      mapped_state: 0 Bear, 1 Neutral, 2 Bull
      probabilities aligned to mapped order (length 3)
      raw probabilities for mapped states in order 0,1,2
    """
    model, X, remap = train_or_load(pair, csv_path)
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
