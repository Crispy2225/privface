> Current demonstration setup: see [M3 refined demo](M3-REFINED-DEMO.md). Earlier model measurements below are historical. Biometric acceptance remains unmet.

# M2 — Quantized model and proving feasibility

Reviewed: 1 November 2026. Baseline: `5cdf6c8` plus the existing M1 documentation.

See [2 November verification and candidate development](M2-VERIFICATION.md) for current acceptance targets, new candidate evidence, and measured whole-browser memory. M2 remains open.

## Status and completion boundary

**Completed:** a reproducible trained integer research model, exact reference arithmetic, explicit preprocessing boundary, versioned model/policy/template format, and measured full-model proving in Node and Chromium.

**Unresolved:** selecting a model accurate enough for useful face authentication. The selected small model is an engineering demonstrator, not an accepted authentication model. Its held-out false rejection rate is 79.17%. Do not describe M2 as fully satisfying biometric suitability or the final synopsis objective. M3 is implemented for this research model; changing the model requires new artifacts and enrollment. M4 should not promote this model into normal login merely because its proofs are fast.

The previous experiment quantized weight storage and descriptors while face-api.js still executed floating-point inference. This stage introduces a separate genuinely integer inference path. The existing 128-dimensional face-api enrollment and password flow remain intact.

## Model choice

Model: `olivetti-mlp-32x32-32-16-v1`.

| Property | Value |
| --- | --- |
| Input | 32 × 32 grayscale byte grid, flattened row-major (1,024 values) |
| Encoder | Dense 1,024 → 32, ReLU, dense 32 → 16 |
| Trainable encoder parameters | 33,328 including biases |
| Output | 16 signed fixed-point embedding coordinates |
| Stored model | 93,677 bytes of JSON |
| Weight scale | 256 |
| Hidden/output scale | 128 |
| Model weights | Public constants compiled into the circuit |
| Inference backend | Shared integer JavaScript reference and Circom circuit |
| Prover | Existing Circom / Groth16 / snarkjs stack |

This deliberately small MLP establishes a complete, affordable inference proof. It is not a replacement for a modern pretrained face-recognition network. Public constant weights make dense layers linear expressions in the circuit; constraints are concentrated in range checks, rounding, ReLU, commitments and matching. This is why parameter count alone does not predict proof cost.

Relevant implementation:

- `zk/ml/train.py`: offline training, quantization and evaluation.
- `zk/ml/reference.py`: independent Python integer oracle.
- `client/public/zkml/model.json`: frozen exported weights.
- `client/public/zkml/runtime.mjs`: browser/Node integer reference.
- `zk/circuits/zkml.circom`: complete inference relation.

## Data, training and experiment discipline

Dataset: the modified Olivetti faces dataset, credited to **AT&T Laboratories Cambridge**. It has 400 grayscale images of 40 subjects. The downloader verifies SHA-256
`b612fb967f2dc77c9c62d3e1266e0c73d5fca46a4b8906c18e454d41af987794`
before parsing any image data. The raw images and local fixtures stay under ignored `data/zkml/`; they are not distributed with source or evidence reports.

The seed `20261101` fixes a subject-disjoint split: 24 training identities, 8 calibration identities and 8 test identities. Exact identities are listed in `M2-model-experiment.json`. PCA initialization uses only the training identities. A two-layer encoder and a training-only decoder are then optimized for 600 Adam steps using reconstruction loss plus 0.08 times supervised pair-contrastive loss with margin 2. The decoder is discarded; it is not part of recognition or proving. Calibration/test subjects do not participate in training.

A reconstruction-only alternative was also measured. Its calibration false rejection was 74.17%, worse than 63.89% for the chosen candidate at the same calibration FAR cap. It was not selected. `M2-candidate-comparison.json` records that unsuccessful comparison; both candidates are inadequate for practical authentication. No claim of broad architecture search is made.

The threshold rule maximizes genuine-pair acceptance subject to empirical calibration FAR ≤1%. The resulting integer squared-distance threshold is **8,326**. It is then applied unchanged to test identities. This is a research threshold; `calibrated: false` remains appropriate for the application because real-camera final-model calibration has not occurred.

## Exact numeric contract

For every pixel byte `p`, form `x = p - 128`. Offline conversion stores:

```text
Wq = floor(256 × W + 0.5)
bq = floor(32768 × b + 0.5)

A1[j] = Σ W1q[j,i] × (pixel[i] - 128) + b1q[j]
Hq[j] = max(0, floor((A1[j] + 128) / 256))
A2[k] = Σ W2q[k,j] × Hq[j] + b2q[k]
Eq[k] = floor((A2[k] + 128) / 256)
distance = Σ (enrolledEq[k] - probeEq[k])²
accept iff distance ≤ 8326
```

Rounding is nearest with ties toward positive infinity, including negative values. Python uses floor division; JavaScript explicitly uses `Math.floor`. This is not truncation toward zero. No clipping or saturation is allowed. Inputs must be bytes; hidden values fit unsigned 16 bits; embeddings fit signed 16 bits. Conservative bounds across **all possible byte inputs**, not just dataset samples, bound the largest accumulator magnitude by 3,987,134. JavaScript integer operations are therefore exact, well below 2^53. Circom checks the signed shifted accumulators with 32-bit decomposition, avoiding field-wrap ambiguity.

The circuit decomposes `A + 2^31 + 128` into bits, discards the low eight bits and subtracts `2^23`. This constrains both quotient and remainder. ReLU selects the nonnegative rounded value using the constrained sign bit.

## Preprocessing boundary

Detection, alignment, image decoding, resizing and conversion to grayscale occur **outside** the proof. The lab requires the user to supply a tightly cropped, aligned face. It stretches that crop to 32×32 using browser canvas and converts RGB using `(77R + 150G + 29B + 128) >> 8`.

The proved statement begins at the resulting private 1,024-byte grid. Pixel centering and all subsequent neural arithmetic are inside the circuit. Browser image resizing is not claimed deterministic across browsers; identical pixel grids are deterministic. The research dataset uses exact 2×2 box averaging from already-gray 64×64 images. This preprocessing/domain difference is another reason these results do not establish webcam performance.

An old image, a non-face pattern or an adversarially constructed crop can still be a valid input. Proof soundness does not certify a camera, a live person or civil identity.

## Results

See the machine-readable `M2-model-experiment.json`, `M3-proof-experiment.json` and `M3-browser-experiment.json` for exact values and setup identities.

| Measurement | Result |
| --- | --- |
| Calibration pairs | 360 genuine; 2,800 impostor |
| Calibration FAR / FRR | 0.964% / 63.889% |
| Test pairs | 360 genuine; 2,800 impostor |
| Test false accepts | 43 / 2,800 (1.536%) |
| Test false rejects | 285 / 360 (79.167%) |
| Float test FAR / FRR, separately calibrated | 1.714% / 78.611% |
| Quantization embedding RMSE | 0.00758 in unscaled coordinates |
| Maximum embedding coordinate error | 0.02894 |
| Full circuit | 13,110 constraints; 12,999 wires |
| Browser proving, two initial runs | About 1.1 seconds per proof |
| Browser proof verification | About 36–37 ms |
| Proof JSON | About 720–725 bytes; not binary proof size or total request size |
| Proving key / witness WASM | 12,135,528 / 4,082,068 bytes |

The float model also rejects most genuine test pairs, so quantization alone does not explain the poor result. Pair observations share subjects/images and are correlated; 2,800 pairs are not 2,800 independent participants. This dataset is small, historical and controlled. Do not extrapolate its error rates to a target population.

Node peak RSS is recorded for the entire test process, including multiple proofs/checks. The browser report contains only a JS heap snapshot, which excludes peak worker/WASM memory. Neither is a comprehensive M7 memory benchmark. Tests ran on macOS/arm64 with Node 24.22.1 and headless Chrome 156; no phone or physical webcam was used.

## Versioning and compatibility

The SHA-256 of exact model JSON bytes binds architecture, weights and numeric/preprocessing identifiers. Its field-reduced value is embedded in the circuit as `modelTag`. The policy has a separate content hash and `policyTag`. Full hashes are retained in artifact manifests; field reduction is only for the proof interface.

New template format: `privface-zkml-template-v1`, containing account, model hash, preprocessing/quantization identifiers, binding version, embedding, secret opening and commitment. The lab holds it in memory only. It is not silently converted from legacy face-api templates. M4 must add password-authorized persistent encrypted enrollment and session lifecycle integration. Model changes require new setup, a new commitment and re-enrollment.

## Reproduction

The committed model does not require retraining to run proofs. To reproduce training separately:

```sh
python3 -m venv /tmp/privface-ml-env
/tmp/privface-ml-env/bin/pip install -r zk/ml/requirements.txt
OPENBLAS_NUM_THREADS=1 VECLIB_MAXIMUM_THREADS=1 \
  /tmp/privface-ml-env/bin/python zk/ml/train.py --output-root /tmp/privface-model-reproduction
```

Compare the exported model hash with the report. Floating-point training can differ across NumPy/BLAS platforms; the committed integer model is the authoritative reproducible inference artifact. Never overwrite a live model without rebuilding its setup. The reconstruction-only candidate uses `--contrastive-weight 0` in a separate output root.

For proving setup/tests, follow [M3](M3-ZKML.md). Improving recognition requires a stronger model/training data and another measured model/prover experiment; changing only the acceptance threshold trades false rejects for false accepts.

## Sources

- [Olivetti dataset description and attribution](https://github.com/scikit-learn/scikit-learn/blob/main/sklearn/datasets/descr/olivetti_faces.rst)
- [Official loader and checksum](https://github.com/scikit-learn/scikit-learn/blob/main/sklearn/datasets/_olivetti_faces.py)
- [Circom constraint generation](https://github.com/iden3/circom/blob/master/mkdocs/docs/circom-language/constraint-generation.md)
- [snarkjs proving and browser usage](https://github.com/iden3/snarkjs)
