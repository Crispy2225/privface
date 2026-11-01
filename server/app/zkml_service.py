"""M3 verifier adapter. No authentication route or session authority (M4).

The caller must supply expected context from trusted challenge storage. This
adapter cannot establish nonce freshness or camera provenance by itself.
"""
import json
import subprocess
import threading
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

class ZkMLVerifier:
    def __init__(self, node_binary='node'):
        self.node = node_binary
        self.slots = threading.BoundedSemaphore(2)

    def verify(self, proof, public_signals, *, expected, setup_id):
        payload = json.dumps({'proof': proof, 'publicSignals': public_signals,
                              'expected': expected, 'setupId': setup_id})
        if len(payload.encode()) > 32768:
            return False
        if not self.slots.acquire(blocking=False):
            raise RuntimeError('ZkML verifier busy')
        try:
            result = subprocess.run(
                [self.node, str(ROOT / 'zk/scripts/verify-ml.mjs')],
                input=payload, text=True, capture_output=True, timeout=20, check=True)
            return json.loads(result.stdout).get('valid') is True
        except (OSError, ValueError, subprocess.SubprocessError):
            return False
        finally:
            self.slots.release()
