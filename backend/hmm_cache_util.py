"""Load HMM pickle caches; drop incompatible files (e.g. NumPy 2 pickle on NumPy 1)."""

from __future__ import annotations

import pickle
from pathlib import Path
from typing import Optional, TypeVar

T = TypeVar("T")


def load_hmm_pickle(cache_path: Path) -> Optional[T]:
    """
    Return unpickled payload or None if missing / unreadable.
    Deletes the file when unpickling fails (common: ``No module named 'numpy._core'``
    when the cache was written with NumPy 2.x but the runtime has NumPy 1.x).
    """
    if not cache_path.is_file():
        return None
    try:
        with open(cache_path, "rb") as f:
            return pickle.load(f)  # type: ignore[no-any-return]
    except Exception:
        try:
            cache_path.unlink(missing_ok=True)
        except OSError:
            pass
        return None
