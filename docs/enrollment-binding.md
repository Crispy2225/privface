# Enrollment and account binding

The implementation and protocol are documented in [IMPLEMENTATION.md](IMPLEMENTATION.md), especially sections 3, 7 and 8.

Local templates are still AES-256-GCM encrypted in IndexedDB, with their non-extractable keys stored locally. The API now supports invitation-authorized passkey registration, passkey login, sessions, and fresh passkey authorization of account-bound blinded commitments. It validates expiring, single-use challenges transactionally.

The commitment scheme is `sha256-blinded-v1`; quantization is `int16-s4096-v1`. It is versioned and has not been integrated into a ZK circuit. Images, descriptors, encryption keys and commitment openings remain local.

A passkey authorizes an account and its commitment. It does not attest that a descriptor came from a live camera. Server authentication remains passkey-based; browser face matching is a local convenience. ZK verification and trusted capture remain future work. Real biometric calibration and spoof evaluation remain necessary.
