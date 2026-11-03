# Pretrained teacher and distillation experiment

The local pretrained face-api.js recognition encoder achieved 96.67% genuine acceptance (348/360) with zero observed false matches among 2,800 calibration impostor pairs. This is not fresh held-out accuracy or proof of population FMR. Pretraining identity overlap is unknown. Inputs were the existing 32x32 grayscale crops replicated into RGB; no old test identities were extracted.

A bounded four-configuration QAT pair-distance distillation search selected settings through four training-identity folds. The selected 32-hidden-unit, 16-output student achieved only 27.78% calibration genuine acceptance (100/360), also with zero observed impostor matches. It was rejected. The active model and prior 70.56% candidate remain unchanged. Neither teacher nor distilled student received proof setup or browser proof benchmarks.

The experiment demonstrates a promising pretrained representation, not a completed M2 model. Next test a larger student and a better distillation objective, then evaluate quantization/proof feasibility and fresh identities.

Licensing sources: face-api.js MIT license at https://github.com/justadudewhohacks/face-api.js/blob/master/LICENSE and upstream dlib model repository CC0 listing at https://github.com/davisking/dlib-models . Exact local teacher asset hashes are recorded in docs/M2-teacher-experiment.json.

Offline tools are in zk/ml/teacher. Set TEACHER_CACHE to a private directory containing pixels.json with pixels and labels arrays for the 24 training and 8 calibration identities only. Run extract.cjs, evaluate.py, then distill.py with --data-root and a fresh --output-root. Use the pinned NumPy/Torch requirements in zk/ml/accuracy. The cache contains biometric data and must remain untracked. Extraction uses installed face-api.js and local weights. No new external model was downloaded.
