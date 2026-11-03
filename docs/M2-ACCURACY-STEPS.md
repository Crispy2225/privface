# M2 accuracy experiments - 2 November 2026

All percentages below are genuine-pair acceptance on the existing calibration identities, with the empirical false-match cap held at 0.0001. Each selected candidate observed zero false matches in 2,800 correlated calibration pairs. This does not establish population FMR. No old test identities were evaluated.

| Step | Genuine acceptance |
| --- | ---: |
| Reproduced Fisher baseline | 58.06% |
| Training-only Fisher configuration search | 59.72% |
| Training-only augmentation selection | 50.83% |
| Quantization-aware metric learning | 69.72% |
| Integer direction-matching diagnostic | 46.11% |
| Gentler QAT learning-rate/duration search | 70.56% |

The 75-80% target was not reached. Each grid selected its configuration by four subject-disjoint folds within the 24 training identities. Successive experiments and the final candidate comparison have inspected the same calibration set; this is exploratory model development, not unbiased test performance. Fresh independent data is required. All 320 training/calibration crops for the exported refined candidate matched the independent arbitrary-precision integer oracle, and conservative all-byte numeric bounds passed.

The new candidate lives in `zk/candidates/qat-refined/`. It is NOT active and has NOT had its proof artifacts rebuilt or browser performance verified. Existing active model, policy and setup are unchanged. Its calibration threshold is 74682. It rejects 106 of 360 genuine pairs. M2 remains open.

## Reproduction

Install `zk/ml/accuracy/requirements.txt` in an isolated Python environment. The data root must contain `data/zkml/olivettifaces.mat`; its checksum is validated. Each output root must be new.

```sh
python zk/ml/accuracy/search.py --data-root /path/to/cache --output-root /tmp/new-search
python zk/ml/accuracy/augment.py --data-root /path/to/cache --output-root /tmp/new-augmentation
python zk/ml/accuracy/metric.py --data-root /path/to/cache --output-root /tmp/new-metric
python zk/ml/accuracy/cosine.py --data-root /path/to/cache --output /tmp/new-cosine.json
python zk/ml/accuracy/metric_refine.py --data-root /path/to/cache --output-root /tmp/new-refinement
```

Training uses CPU, a fixed seed, and one Torch thread. Experiments retain unsuccessful results. The augmentation script reuses the Fisher fitting source with explicit fitting-data substitutions; these are offline research tools, not application runtime code.

Next work: evaluate stronger pretrained representations and/or additional licensed training data, then distill into a proof-compatible encoder. Freeze the candidate before new independent evaluation. Further searches on these few calibration identities risk overfitting the measurement rather than improving generalization.
