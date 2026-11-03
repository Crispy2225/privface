# M2 follow-up — 2 November 2026

M2 remains open. M3 continues to work for the existing frozen research model.

A calibration-only diagnostic compared PCA and regularized Fisher projections. The best measured calibration result was PCA64/Fisher16 with 0.1 covariance shrinkage: FAR 1%, FRR 22.78%. The existing neural candidate had calibration FRR 63.89%. These are calibration results, not fresh held-out performance. No test identities were used by this diagnostic.

The Fisher representation is a linear statistical baseline, not an implemented replacement neural encoder. It provides evidence that representation learning can improve on the current tiny autoencoder. Next, evaluate a Fisher-initialized or distilled neural encoder using training/calibration identities, then freeze the choice before a new held-out evaluation. Do not repeatedly optimize against the old test results. Quantize any selected replacement, rebuild its circuit artifacts, and rerun the browser proof tests.

Reproduce from the repository root:

```sh
python zk/ml/diagnose.py --data-root /path/to/dataset-cache-root --output /tmp/calibration-diagnostics.json
```

The data root contains `data/zkml/olivettifaces.mat`; the original dataset checksum is checked. NumPy is required. See `M2-calibration-diagnostics.json` for all nine candidates, exact pair counts and splits. This diagnostic does not alter the active model or policy.

## Verification and candidate implementation follow-up

See [M2 verification](M2-VERIFICATION.md) for the implemented integer Fisher candidate, separate full proof/browser evidence, 20-run timing and whole-browser RSS measurements, acceptance checker, and remaining blockers. M2 remains unaccepted: the new candidate has 41.94% calibration false rejection at the stricter threshold while sampled browser RSS (~1.22 GiB) passes the revised 2 GiB desktop budget for the user-selected 16 GiB M5 MacBook Air running Chrome. Recognition and independent validation remain blockers. The active model was preserved.
