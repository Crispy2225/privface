# M3 refined demonstration model - 2 November 2026

M3 is verified for the frozen 70.56% calibration genuine-acceptance candidate. M2 demonstration feasibility is accepted; original biometric suitability remains unmet. M4 face-first login is not implemented by this change.

Model SHA-256: e26af1fb1b4f9ad0e9b46f95206ae706973ac41170505fc887ba19d354ad4ff4
Setup ID: 79e2577255984e391519709d7327f1b8f83d74ac446334a0a89e69303fc1fea2

- Full proof checks: 38 passed, including enrollment, matching, Python/JavaScript/Circom parity, tampered public signals and malicious intermediate witnesses.
- Real Chromium smoke tests passed.
- Server verifier adapter: 2 tests passed.
- 20-run Chrome p95 proving: 1084.7 ms.
- Sampled whole-browser peak RSS: 1274.03 MiB.
- Desktop budgets: 5 seconds p95 and 2 GiB sampled browser RSS; both passed.

Development-only trusted setup. No physical-camera accuracy or fresh independent evaluation is claimed. The threshold remains 74682. Changed model/setup identities require new enrollment; previous templates are incompatible. The previous setup is preserved locally at /Users/atharv/Documents/Codex/2026-11-02/we-x20/work/m3-before-refined. Password login is unchanged. The research lab uses the new model.

Next: M4 authorized enrollment, encrypted template persistence, single-use server challenges and session issuance after verified face proofs, with replay/stale-binding/concurrency tests and password fallback.
