"""Export the calibration-selected Fisher baseline as an integer ReLU encoder.

This is a statistical projection represented by a neural architecture, not a
newly trained nonlinear recognition network. Never evaluates old test subjects.
"""
import argparse
import hashlib
import json
from pathlib import Path
import numpy as np
import train
from reference import infer


def calibrate(embedding, labels, subjects, far_cap):
    indices = np.flatnonzero(np.isin(labels, subjects))
    a, b = np.triu_indices(len(indices), 1)
    e, y = embedding[indices], labels[indices]
    distances = np.sum((e[a] - e[b]) ** 2, axis=1)
    genuine = y[a] == y[b]
    candidates = np.unique(distances[genuine])
    allowed = candidates[np.searchsorted(np.sort(distances[~genuine]), candidates, side='right') / (~genuine).sum() <= far_cap]
    limit = float(allowed[-1]) if len(allowed) else float(np.nextafter(distances[~genuine].min(), -np.inf))
    if np.issubdtype(embedding.dtype, np.integer):
        limit = int(np.floor(limit))
    return train.metrics(embedding, labels, subjects, limit)


def fit(pixels, labels, train_subjects):
    x = (pixels - 128) / 128
    mask = np.isin(labels, train_subjects)
    mean = x[mask].mean(0)
    _, _, v = np.linalg.svd(x[mask] - mean, full_matrices=False)
    z = (x[mask] - mean) @ v[:64].T
    y = labels[mask]
    centers = np.stack([z[y == s].mean(0) for s in train_subjects])
    residual = np.concatenate([z[y == s] - centers[i] for i, s in enumerate(train_subjects)])
    within = residual.T @ residual / len(residual)
    covariance = .9 * within + .1 * np.trace(within) / 64 * np.eye(64)
    ev, u = np.linalg.eigh(covariance)
    whiten = (u / np.sqrt(np.maximum(ev, 1e-8))) @ u.T
    _, basis = np.linalg.eigh(whiten @ np.cov(centers, rowvar=False) @ whiten)
    projection = v[:64].T @ whiten @ basis[:, -16:]
    # Canonicalize eigenvector signs and set a train-only common numeric scale.
    for j in range(16):
        if projection[np.argmax(np.abs(projection[:, j])), j] < 0:
            projection[:, j] *= -1
    projection /= np.sqrt(np.mean(((x[mask] - mean) @ projection) ** 2))
    if not np.isfinite(projection).all():
        raise ValueError('Non-finite fitted projection')
    # ReLU(z) - ReLU(-z) = z. Preserve the existing 1024/32/16 circuit.
    w1 = np.concatenate([projection, -projection], axis=1)
    b1 = -mean @ w1
    w2 = np.concatenate([np.eye(16), -np.eye(16)], axis=0)
    q = lambda a: np.floor(a + .5).astype(np.int64)
    qw1, qb1, qw2 = q(w1 * 256), q(b1 * 32768), q(w2 * 256)
    bound1 = 128 * np.abs(qw1).sum(0) + np.abs(qb1)
    boundh = (bound1 + 128) // 256
    bound2 = boundh @ np.abs(qw2)
    if max(bound1.max(), bound2.max()) + 128 >= 2**31 or boundh.max() >= 65536 or ((bound2 + 128) // 256).max() >= 32768:
        raise ValueError('Candidate exceeds circuit numeric bounds')
    model = dict(format='privface-mlp-int-v1', id='olivetti-fisher-relu-32x32-32-16-v1',
                 preprocessing='aligned-gray32-u8-v1', quantization='w256-a128-round-half-up-v1',
                 inputSize=1024, hiddenSize=32, embeddingSize=16, weightScale=256, activationScale=128,
                 w1=qw1.T.tolist(), b1=qb1.tolist(), w2=qw2.T.tolist(), b2=[0]*16,
                 researchOnly=True, trainingDatasetSHA256=train.SHA)
    integer = (np.maximum(0, ((pixels-128) @ qw1 + qb1 + 128)//256) @ qw2 + 128)//256
    floating = (x - mean) @ projection
    return model, integer, floating, int(max(bound1.max(), bound2.max()))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--data-root', type=Path, default=train.ROOT)
    parser.add_argument('--output-root', type=Path, required=True, help='New directory; existing destinations are rejected')
    args = parser.parse_args()
    if args.output_root.exists():
        parser.error('Output root must not exist; preserve previous models and proof artifacts')
    train.ROOT = args.data_root.resolve()
    pixels, labels = train.dataset()
    subjects = np.random.default_rng(20261101).permutation(40)
    training, calibration = subjects[:24], subjects[24:32]
    keep = np.isin(labels, np.concatenate([training, calibration]))
    pixels, labels = pixels[keep], labels[keep]
    model, integer, floating, bound = fit(pixels, labels, training)
    # Independent arbitrary-precision oracle checks every training/calibration crop.
    for p, e in zip(pixels, integer):
        if infer(model, p.tolist()) != e.tolist():
            raise ValueError('Integer oracle disagreement')
    encoded = (json.dumps(model, separators=(',', ':')) + '\n').encode()
    digest = hashlib.sha256(encoded).hexdigest()
    research = calibrate(integer, labels, calibration, .01)
    strict = calibrate(integer, labels, calibration, .0001)
    float_research = calibrate(floating * 128, labels, calibration, .01)
    float_strict = calibrate(floating * 128, labels, calibration, .0001)
    if not 0 < strict['limit'] < 2**32:
        raise ValueError('No circuit-compatible strict threshold')
    if not np.isfinite(floating).all():
        raise ValueError('Non-finite floating reference')
    report = dict(scope='Calibration-only candidate, not fresh held-out or authentication suitability evidence',
                  datasetSHA256=train.SHA, modelSHA256=digest, modelJSONBytes=len(encoded),
                  trainingSubjects=training.tolist(), calibrationSubjects=calibration.tolist(), heldOutTestUsed=False,
                  selection='PCA64/Fisher16/shrink0.1 fixed from prior calibration diagnostics',
                  architecture='Signed ReLU realization of linear Fisher projection; no nonlinear fine-tuning',
                  integerCalibrationResearch=research, integerCalibrationStrict=strict,
                  floatCalibrationResearch=float_research, floatCalibrationStrict=float_strict,
                  quantization=dict(rmse=float(np.sqrt(np.mean((integer/128-floating)**2))),
                                    maxEmbeddingError=float(np.max(np.abs(integer/128-floating))), maxAccumulatorBound=bound),
                  oracleCases=len(pixels), numpy=np.__version__,
                  acceptance=dict(accepted=False, reasons=['No fresh independent evaluation', 'No demographic or camera evaluation',
                                 'Calibration pairs are correlated and insufficient to establish FMR <= 0.0001',
                                 'Candidate requires separate proof setup and device benchmark']))
    pub = args.output_root/'client/public/zkml'
    pub.mkdir(parents=True)
    (args.output_root/'docs').mkdir()
    (pub/'model.json').write_bytes(encoded)
    (pub/'policy.json').write_text(json.dumps(dict(format='privface-zkml-policy-v1', modelSHA256=digest,
        limit=str(int(strict['limit'])), calibrated=False, researchDatasetCalibrated=True,
        purpose='Unaccepted M2 Fisher research candidate; strict calibration threshold, fresh validation pending'), indent=2)+'\n')
    (args.output_root/'docs/M2-fisher-experiment.json').write_text(json.dumps(report, indent=2)+'\n')
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    main()
