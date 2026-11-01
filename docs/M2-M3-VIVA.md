# PrivFace — M2 and M3 viva guide

## A 60-second explanation

“PrivFace investigates private face authentication. Facial processing and proof generation happen locally, and a verifier checks a cryptographic proof instead of receiving a face image or embedding. The existing application uses password login and a descriptor-comparison proof. In M2, we built a small trained neural network with deterministic integer inference and measured its feasibility. In M3, we implemented a circuit that proves the whole encoder computation on a private aligned crop and binds its output to enrollment or matching. We generated real proofs in a browser in about 1.1 seconds in our initial tests. This establishes browser-proving feasibility, but our small model has poor recognition accuracy. We have not enabled it as a face-login credential. Better biometric performance and M4 session integration remain necessary.”

This is a defensible statement of the implemented result. Do not claim production face login, successful anti-spoofing, a camera-attested image, or high face-recognition accuracy.

## Stage map

| Stage | What to explain | Actual status |
| --- | --- | --- |
| M1 | Protocol, privacy assumptions, session/enrollment rules | Specification and baseline complete |
| M2 | Model, integer arithmetic, data split and feasibility | Research pipeline implemented; acceptable biometric model still unresolved |
| M3 | Complete inference proof, commitment, context, browser worker | Implemented and tested for the small research model |
| M4 | Proof-created sessions and password fallback | Pending |
| M5 | Final-model calibration and held-out participant study | Pending; current small-dataset results are preliminary evidence |
| M6 | Spoofing, malicious-client, privacy and device trials | Some protocol tests exist; full evaluation pending |
| M7 | Repeated cold/warm time and memory benchmarks | Initial measurements exist; systematic evaluation pending |
| M8 | Clean-install reproduction, final report and demo | Documentation foundation exists; final delivery pending |

## M2: questions and answers

### 1. Why is a quantized model necessary?

The circuit operates over finite-field integers. Ordinary floating-point operations do not directly have the same meaning there. Fixed-point quantization expresses the weights and activations as bounded integers with explicit scales and rounding. Browser reference inference and the circuit must agree exactly.

### 2. How is this different from the earlier quantization experiment?

Previously, smaller weight storage was decoded for floating-point inference, and the resulting descriptor was quantized. Now both dense layers, ReLU and rounding execute as integer operations and are enforced by the proof circuit. Compressing model files alone is not quantized inference.

### 3. Which model did you choose, and why?

A 1,024 → 32 → 16 multilayer perceptron with ReLU. It consumes a 32×32 grayscale crop and has 33,328 encoder parameters. Its small size makes it suitable for proving experiments and explanation. It is a research encoder, not a state-of-the-art face recognizer. The original face-api network is still used by the existing application path.

### 4. Was the model actually trained?

Yes. It uses the Olivetti/AT&T face dataset, training-only PCA initialization, and 600 Adam steps. Training combines reconstruction with pair-contrastive loss. A decoder is used only during training and is discarded afterward. The circuit proves the encoder, not the training process or decoder.

### 5. How did you prevent data leakage during evaluation?

The 40 identities are partitioned before training into 24 training, 8 calibration and 8 test identities using a fixed seed. Initialization and optimization use training identities only. Threshold selection uses calibration identities. Test identities are evaluated with the fixed threshold. The exact split is saved in the report.

### 6. What is the precise arithmetic?

For each layer, multiply integer inputs by weights scaled by 256, add bias scaled by 32,768, add 128 and floor-divide by 256. Hidden and output values represent real numbers multiplied by 128. Apply ReLU after the first layer. Pixel centering subtracts 128 inside the circuit. See `M2-MODEL-FEASIBILITY.md` for the equations.

### 7. What happens with negative rounding or overflow?

Rounding uses floor division after adding half the divisor. For example, `floor((-384+128)/256) = -1`; ties go toward positive infinity. Bounds and bit decompositions prevent invalid values. The design rejects overflow instead of silently clipping. An independent Python reference and circuit witness tests cover signed behavior.

### 8. How do you know JavaScript is exact here?

All inference values are integers. Conservative accumulator bounds are below four million for this frozen model, much smaller than JavaScript's exact integer range of 2^53. We are not claiming arbitrary JavaScript floating-point inference matches a circuit.

### 9. What is inside the proof's preprocessing boundary?

The private 32×32 grayscale byte grid is the starting input. Pixel centering, dense layers, rounding and ReLU are proved. Decoding a JPEG, detection, alignment, resizing and grayscale conversion are outside the circuit. Therefore the claim is inference on a supplied aligned crop, not the complete camera-to-embedding pipeline.

### 10. How accurate is the model?

On the eight held-out identities, it falsely accepts 43 of 2,800 impostor pairs (1.536%) and falsely rejects 285 of 360 genuine pairs (79.167%) at the calibration-selected threshold. That is inadequate for useful login. The floating-point version also performs poorly, so the main problem is the model/data setup, not just quantization. Fast proving must not be presented as accurate recognition.

### 11. What do FAR and FRR mean?

FAR is the proportion of different-person comparisons incorrectly accepted. FRR is the proportion of same-person comparisons incorrectly rejected. Raising the distance threshold generally reduces false rejection while increasing false acceptance. A single “accuracy” percentage can obscure this tradeoff and the imbalance between genuine and impostor pairs.

### 12. What did the feasibility experiment establish?

It established that this entire small neural encoder can be represented consistently, proved locally in a browser and verified with modest proof size. It did not establish that a larger accurate recognizer will have the same proving performance, or that this model is ready for deployment.

## M3: questions and answers

### 13. What exactly does a valid proof establish?

That there exist private input pixels, an enrolled descriptor and an opening such that the pinned neural encoder was evaluated correctly; the descriptor opens the expected account/model commitment; and the selected enrollment or matching relation holds under the expected public context.

### 14. What changed from the old descriptor-only proof?

The old circuit accepted an enrolled descriptor and a probe descriptor as independent private inputs. A modified client could copy the enrollment into the probe. The new circuit accepts pixels and computes the probe embedding itself. The test suite attempts descriptor substitution and rejects it when the supplied pixels do not match.

### 15. Why are enrollment and matching separate operations?

Enrollment must prove that the committed template came from the approved network. Matching must prove proximity to an already-authorized template. Operation 1 enforces equality between inference output and enrollment; operation 2 enforces the distance limit. The operation is public and context-bound, preventing the verifier from accepting one operation as the other.

### 16. What is a commitment, and why add randomness?

A commitment binds an account/model to a private template without publishing that template. We use Poseidon with a fresh secret 248-bit opening and domain separation. The randomness prevents straightforward guessing against a deterministic public hash. The opening remains private and is necessary to generate matching proofs.

### 17. Why Poseidon?

It is designed for efficient arithmetic-circuit use. The existing project already uses it and circomlib supplies the circuit. The browser reference is checked against actual proof generation. Using a circuit-friendly hash reduces the cost compared with implementing a general-purpose bit-oriented hash throughout the commitment relation.

### 18. What does the nonce accomplish?

It binds the proof to a particular challenge. However, the server must also issue a fresh nonce and atomically consume the challenge. A stateless verifier will accept the same valid proof again under the same context. The M3 lab generates local demo challenges; actual server challenge lifecycle and session creation belong to M4.

### 19. Does zkML prove liveness?

No. It proves the specified computation on the input, not the physical origin or freshness of that input. An old matching image can be used to generate a new proof for a fresh nonce. Browser movement checks are heuristics. Trusted capture or an explicitly restricted security claim is a separate design issue.

### 20. Can an attacker change the model or threshold?

The model weights and model identity are compiled into the circuit, and the verifier uses a pinned verification key. The threshold and policy identity must match trusted expected server context. Tests change each public signal and verify rejection. The verifier must never trust context merely because the requester supplied it.

### 21. What keeps a dishonest intermediate activation from passing?

Every activation is linked by constraints to preceding arithmetic. The test suite edits a hidden activation directly in a witness file, bypassing the honest JavaScript calculator, and confirms that the R1CS constraints reject it. This distinguishes circuit enforcement from ordinary client input validation.

### 22. What leaves the browser?

The intended verifier payload is the proof and public context, not pixels, embeddings or secret openings. The standalone research lab performs verification locally and sends no proof to a server; its browser test observed only same-origin GET requests for assets. The Python verifier adapter was separately tested with proofs/public inputs. Actual authenticated network integration is M4.

### 23. What are the measured costs?

The circuit has 13,110 constraints. Initial headless Chrome runs took about 1.1 seconds to prove and 36–37 ms to verify. Proof JSON was about 720–725 bytes. The proving key is about 12.1 MB and the witness WASM about 4.1 MB, so proof size must not be confused with first-load download cost. These are initial measurements, not phone benchmarks or latency percentiles.

### 24. Why a worker? Can the user cancel?

Proof generation runs in a Web Worker to keep the page responsive. Cancellation, leaving/hiding the page or a 90-second timeout terminates the worker. Tests exercise cancellation and timeout. Public assets are hash-checked before use.

### 25. What is the trusted-setup limitation?

Groth16 needs circuit-specific setup. This project uses a single-party local development setup, verified for artifact consistency. That does not demonstrate secure destruction of setup secrets or provide a production ceremony. The lab is explicitly restricted to local research use.

### 26. Is encryption the same as zero knowledge?

No. Encryption protects stored template bytes subject to key security. A zero-knowledge proof lets a verifier check a relation without receiving the private witness. Neither protects an unlocked browser from malicious same-origin code. The main app encrypts stored templates; the research lab keeps its temporary template in memory only.

### 27. Can you now log in with your face alone?

No. The inference proof and verifier adapter work, but M4 must connect them to authorized enrollment, server-issued challenges, atomic session creation and fallback. The existing app continues to use passwords. The research model must also improve before it is suitable for normal login.

### 28. What is your contribution and what is reused?

The project adds the integer model export/reference, exact inference relation, account/model commitments, operation/context binding, artifact manifests, browser integration, verifier adapter and tests. It reuses established Circom, circomlib, snarkjs/Groth16 and NumPy components. It does not invent a new cryptographic proof system.

## Demo script

1. Show the stage status and explain the model-accuracy limitation first.
2. Run `npm --prefix zk run test:ml`. Explain that its synthetic grids test computation and adversarial cases, not identity recognition.
3. Open `http://localhost:5173/zkml.html` after setup and starting the app.
4. Select an aligned crop and prove enrollment. Explain the commitment and private opening.
5. Select the same image to demonstrate the matching-proof path; explicitly say that same-image success is not evidence of real-world recognition accuracy.
6. Try a different capture if available, and report a rejection honestly. Do not adjust thresholds during the demonstration to manufacture success.
7. Show cancellation and the measured proof summary.
8. Show the held-out accuracy report, the M4 boundary and the next model-quality work.

## Files to know before the viva

| File | Purpose |
| --- | --- |
| `zk/ml/train.py` | Training, quantization, subject split and preliminary evaluation |
| `zk/ml/reference.py` | Independent exact integer oracle |
| `client/public/zkml/runtime.mjs` | Browser reference inference and commitment/context encoding |
| `zk/circuits/zkml.circom` | The actual mathematical statement enforced by the proof |
| `zk/scripts/setup-ml.mjs` | Model constants, circuit compilation and development setup |
| `client/public/zkml/client.mjs`, `worker.js` | Local proving, integrity checks and cancellation |
| `server/app/zkml_service.py` | Bounded server verifier adapter; no session issuance |
| `docs/M2-model-experiment.json` | Accuracy and quantization evidence |
| `docs/M3-proof-experiment.json` | Real proof and adversarial test evidence |
| `docs/M3-browser-experiment.json` | Actual browser-worker evidence |

Keep the claims separate: **valid proof**, **accurate recognition**, **live capture**, and **authorized login** are four different properties. The current M3 work establishes the first for the specified research computation.
