"""PyTorch view of an exported DatasetVersion. torch is imported lazily so the rest of
gnumbat_core has no torch dependency. (Written against the torch.utils.data.Dataset
contract; not exercised in this repo's tests because torch is not installed in CI.)"""
from __future__ import annotations

import numpy as np

from .dataset import ExportedDataset


def make_bake_dataset(export_dir, feature_set: dict, tag_vocab: list[str] | None = None):
    import torch  # noqa: WPS433 (lazy on purpose)
    from torch.utils.data import Dataset

    ex = ExportedDataset(export_dir)
    M, cols, bake_ids = ex.feature_matrix(feature_set)
    mean = np.nanmean(M, axis=0)
    idx = np.where(np.isnan(M))
    M[idx] = np.take(mean, idx[1])
    std = M.std(axis=0)
    std[std < 1e-9] = 1.0
    X = ((M - M.mean(axis=0)) / std).astype(np.float32)
    vocab = tag_vocab or sorted(ex.version["vocabulary"])
    tid = {t: i for i, t in enumerate(vocab)}

    class BakeDataset(Dataset):
        columns = cols
        vocabulary = vocab

        def __len__(self):
            return len(ex)

        def __getitem__(self, i):
            e = ex.example(i)
            tags = [tid[t.lower()] for t in e["tags"] if t.lower() in tid]
            return {"bake_id": e["bake_id"], "features": torch.from_numpy(X[i]), "tag_ids": torch.tensor(tags, dtype=torch.long),
                    "raw_notation": e["raw_notation"]}

    return BakeDataset()
