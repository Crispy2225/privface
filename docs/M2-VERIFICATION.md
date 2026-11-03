> Current demonstration setup: see [M3 refined demo](M3-REFINED-DEMO.md). Earlier model measurements below are historical. Biometric acceptance remains unmet.

# M2 verification and development - 2 November 2026

## Decision

**M2 is not accepted.** Integer inference and full-model proof engineering are verified. Neither the active model nor the new Fisher candidate meets biometric recognition requirements. Both pass the revised desktop proof-time and sampled browser-memory budgets on the measured laptop. Do not promote either into authentication or describe M2 as complete.

The active model, policy, circuit, setup and enrollment compatibility were preserved. The Fisher model is stored separately in `zk/candidates/fisher/`. Existing uncommitted calibration diagnostics were preserved.

## Acceptance targets

- Recognition FMR <= 0.0001 (0.01%) and FNMR < 0.05 (5%), using a threshold frozen on calibration data before independent evaluation. These are matcher metrics; they are not end-to-end transaction FAR/FRR. Existing reports use the historical names FAR/FRR for pairwise matcher errors.
- These accuracy targets follow [NIST SP 800-63B-4](https://pages.nist.gov/800-63-4/sp800-63b.html). NIST calls for FMR compliance across demographic groups; face presentation-attack detection and a possession factor are additional system requirements. This project is not certified by these checks.
- Engineering targets chosen for this review: p95 proof generation <= 5 seconds over at least 20 sequential runs, sampled total dedicated-browser process-tree RSS <= 2 GiB for the user-selected 16 GiB M5 MacBook Air running Chrome. This desktop budget replaces the initial provisional 512 MiB limit at the user's request. It allocates at most 12.5% of installed RAM to the project browser process tree and gives headroom above the measured ~1.22 GiB. It excludes the backend, development server and unrelated browser tabs. These are product budgets, not NIST requirements. Report end-to-end latency separately.
- Initial measured device: Apple M5, 10 logical CPUs, 16 GiB RAM, macOS arm64, Chrome 156. This is a desktop feasibility measurement. Physical mobile-device testing is still needed before claiming phone support.
- Require representative fresh capture data, demographic coverage and an independent-trial statistical analysis. Zero errors in 2,800 correlated impostor pairs cannot establish a population FMR of 0.01%. Reusing already-inspected test subjects does not create a fresh holdout.

## Development added

`zk/ml/train_fisher.py` exports the previously selected PCA64/Fisher16/shrink0.1 baseline into the existing 1024 -> 32 ReLU -> 16 integer architecture. It uses `ReLU(z)-ReLU(-z)=z`: this is a linear statistical representation implemented in a neural architecture, not a newly optimized nonlinear encoder. It fits only training identities, removes old test subjects before embedding/scoring, normalizes using training statistics, canonicalizes eigenvector signs, checks all-byte numeric bounds, and verifies all 320 remaining crops against the independent Python integer oracle. Its required output directory must not exist, preventing accidental replacement of a deployed model or setup.

`client/tests/zkml-benchmark.mjs` runs at least 20 real Chromium worker proofs. It validates every proof, records p95 proof and end-to-end times, and samples the entire dedicated browser process tree with `ps` every 50 ms. Total RSS may double-count shared pages and sampling can miss short peaks. It is broader evidence than a JavaScript heap snapshot, not an exact physical-memory high-water mark.

`zk/ml/check_m2.py` fails closed on missing/mismatched model or setup evidence, absent correctness checks, inadequate recognition evaluation, slow proofs or excessive sampled browser memory. It recomputes p95 from observations rather than trusting a summary. Evaluation review flags are explicit human attestations; the script does not establish their truth or replace review. An exit status of 1 is expected for the current models.

## Results

| Measurement | Active MLP | Fisher candidate |
| --- | ---: | ---: |
| Calibration false rejects at <=1% empirical false matches | 63.89% (previous frozen report) | 23.06% (83/360) |
| Calibration false rejects at <=0.01% empirical false matches | Not recalibrated | 41.94% (151/360) |
| Candidate strict calibration false matches | N/A | 0/2,800; insufficient evidence of target FMR |
| Previous held-out false rejects | 79.17% | Not evaluated on reused test identities |
| 20-run browser p95 proving | 1,069.6 ms | 1,057.0 ms |
| 20-run browser p95 end-to-end | 1,164.3 ms | 1,145.5 ms |
| Sampled whole-browser peak RSS | 1,253.81 MiB | 1,253.63 MiB |
| Full proof checks | 38 passed | 38 passed |

The candidate's floating-point calibration false rejects are 22.78% at the old research cap and 41.39% at the strict cap. Quantized values are 23.06% and 41.94%, respectively. Most recognition error is therefore representation error, not quantization error. The candidate policy uses the strict calibration threshold of 60,666; it remains `calibrated: false` for application use.

Candidate model bytes reproduced identically with installed NumPy 2.0.2 and pinned NumPy 2.3.5. Use the pinned version in `zk/ml/requirements.txt`; some platform/BLAS combinations may differ. The committed candidate is the authoritative integer artifact. The maximum conservative accumulator bound is 1,988,608.

Candidate proof setup was generated separately, with verified development powers of tau and a fresh phase-2 contribution. Both model versions passed real Chromium smoke tests, including tampered input/assets, cancellation, timeout, stale templates, visible controls and clearing. All 39 client tests, 28 server tests and 10 new M2 tests passed. TypeScript checking and the Vite production build passed. Vite used `--configLoader runner` in the isolated verification copy because its node_modules symlink was read-only. The backend emitted one existing Starlette/httpx deprecation warning.

## Reproduction

Use Python with `zk/ml/requirements.txt` installed and existing JS dependencies. From the repository root:

```sh
python3 -m unittest discover -s zk/ml -p test_m2.py
python3 zk/ml/train_fisher.py --data-root /path/to/dataset-cache-root --output-root /tmp/new-fisher-export
# data-root contains data/zkml/olivettifaces.mat; checksum is verified.
# Export includes model, strict research policy and calibration-only report.

npm --prefix zk run test:ml
npm --prefix client run test:zkml-browser
npm --prefix client run benchmark:zkml
npm --prefix zk run check:m2
# check:m2 exits 1 until ALL M2 evidence gates pass.
```

For browser commands, set `PLAYWRIGHT_MODULE` to an installed Playwright module and `CHROME_PATH` if Chromium is not installed through Playwright. The benchmark uses macOS/Linux `ps`, not Windows. Each evidence report contains the exact model and setup identity.

To prove the candidate, use a separate repository copy with dependencies installed. Preserve/exclude the active `zk/artifacts-ml`, `zk/generated`, and `client/public/zkml` generated proof assets/manifest. Copy the exported candidate model and policy into that copy's `client/public/zkml/`, run `setup:ml` per M3, then run the same proof, browser and benchmark commands. Do not overwrite the active setup. In that isolated copy, assess the candidate with:

```sh
python3 zk/ml/check_m2.py --experiment docs/M2-fisher-experiment.json
```

The source export does not include face images or private fixtures. Candidate generated proving binaries remain local experimental assets; reconstruct them with the existing development setup workflow. Reports in this repository retain the measured setup ID.

## Remaining acceptance work

1. Develop a stronger face encoder using licensed training data and calibration identities. The Fisher implementation is a useful quantified baseline, not an accepted replacement.
2. Freeze model, preprocessing and threshold; evaluate new consented/appropriately licensed identities using representative capture, demographic and independent-trial protocols. Do not tune against the previously inspected test set.
3. Confirm the desktop budget during interactive Chrome use with the local backend and development server running. Current headless measurements pass the revised 2 GiB / 5-second desktop gates; they do not measure combined server/browser memory or guarantee absence of system memory pressure. Continue profiling if larger models increase allocations.
4. Rebuild and verify artifacts for the selected model; repeat proof, correctness, latency and memory tests on the declared target hardware.

M3 remains verified for the existing research model. M4 login integration must not treat that fact as M2 biometric acceptance.

## Desktop budget revision

The user selected a 16 GiB M5 MacBook Air with Chrome on 2 November 2026. Existing raw timing and memory measurements were retained and reassessed against 2 GiB peak sampled project-browser RSS and 5-second p95 proof generation. Both models pass these resource gates; recognition and independent validation still block M2. Benchmark reports retain the original 512 MiB budget and outcome in `budgetRevision` for provenance. No new benchmark run is claimed. Two added memory-boundary regression tests pass (12 M2 tests total).
