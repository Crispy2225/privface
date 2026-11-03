"""Fail-closed M2 review: missing evidence never means milestone completion."""
import argparse
import hashlib
import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def assess(model_hash, experiment, proof, browser, benchmark):
    checks = []
    def check(name, passed, detail):
        checks.append(dict(name=name, passed=bool(passed), detail=detail))
    for name, report in [('experiment', experiment), ('proof', proof), ('browser', browser), ('benchmark', benchmark)]:
        check(name + ' model identity', report.get('modelSHA256') == model_hash, 'Evidence must reference exact exported model bytes')
    setup = proof.get('setupId')
    check('consistent proof setup', isinstance(setup, str) and len(setup) == 64 and setup == browser.get('setupId') == benchmark.get('setupId'), 'Proof, smoke test and benchmark must use the same setup')
    required = ['Full enrollment inference proof', 'Full login-relation inference proof with a different crop',
                'Malicious intermediate witness rejected by R1CS (calculator bypassed)']
    check('proof correctness', all(c in proof.get('checks', []) for c in required), 'Enrollment, matching and corrupted-witness rejection required')
    check('browser behavior', all(browser.get(k) is True for k in ['invalidEnrollmentRejected','cancellation','timeout','incompatibleTemplateRejected']), 'Browser negative, cancellation and lifecycle tests required')
    test = experiment.get('integerTest', {})
    def rate(key):
        value = test.get(key)
        return value if type(value) in (int, float) and math.isfinite(value) and 0 <= value <= 1 else None
    check('recognition FMR', rate('FAR') is not None and rate('FAR') <= .0001, 'Fixed-threshold independent test FMR <= 0.01%')
    check('recognition FNMR', rate('FRR') is not None and rate('FRR') < .05, 'Fixed-threshold independent test FNMR < 5%')
    # Existing Olivetti pair counts do not establish low population FMR. These
    # fields are explicit review attestations, not inferred from zero errors.
    validation = experiment.get('validation', {})
    for key, detail in [('freshHeldOut', 'New identities unused in model/threshold selection'),
                        ('representativeCapture', 'Target-camera capture and population protocol reviewed'),
                        ('demographicCoverage', 'Per-group accuracy reviewed'),
                        ('statisticalEvidenceReviewed', 'Independent trials and uncertainty reviewed; correlated pair count is insufficient')]:
        check(key, validation.get(key) is True, detail)
    timings = benchmark.get('timings', [])
    times = [t.get('provingMs') for t in timings if isinstance(t, dict)]
    valid = len(times) >= 20 and all(type(t) in (int,float) and math.isfinite(t) and t > 0 for t in times)
    p95 = sorted(times)[math.ceil(.95 * len(times))-1] if valid else None
    check('proof time', valid and p95 <= 5000, 'At least 20 proofs; recomputed p95 <= 5000 ms')
    memory = benchmark.get('memory', {})
    peak = memory.get('sampledPeakBrowserTreeRSSBytes')
    check('sampled browser memory', type(peak) is int and 0 < peak <= 2*1024*1024*1024 and memory.get('observations', 0) >= 20,
          'Sampled whole-browser process-tree RSS <= 2 GiB (16 GiB M5 Air / Chrome desktop target); short peaks may be missed')
    check('target device declared', bool(benchmark.get('device', {}).get('cpu')), 'Results apply only to recorded hardware/browser; no phone claim')
    return dict(format='privface-m2-review-v1', modelSHA256=model_hash, complete=all(c['passed'] for c in checks), checks=checks,
                note='Automated evidence consistency and acceptance checks; not a security audit or NIST certification')


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--root', type=Path, default=ROOT)
    p.add_argument('--experiment', default='docs/M2-model-experiment.json')
    p.add_argument('--output', type=Path)
    a=p.parse_args()
    def read(name):
        path=a.root/name
        return json.loads(path.read_text()) if path.exists() else {}
    digest=hashlib.sha256((a.root/'client/public/zkml/model.json').read_bytes()).hexdigest()
    report=assess(digest, read(a.experiment), read('docs/M3-proof-experiment.json'), read('docs/M3-browser-experiment.json'), read('docs/M2-browser-benchmark.json'))
    encoded=json.dumps(report,indent=2)+'\n'
    if a.output: a.output.write_text(encoded)
    print(encoded)
    raise SystemExit(0 if report['complete'] else 1)


if __name__ == '__main__':
    main()
