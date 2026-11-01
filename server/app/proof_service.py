"""Pinned real Groth16 verification, supplementary to authenticated password sessions."""
import hashlib
import json
import math
import re
import subprocess
import threading
from pathlib import Path
from .config import MODEL, QUANTIZATION

FIELD=21888242871839275222246405745257275088548364400416034343698204186575808495617
SCHEME='poseidon-int16-v1'
CIRCUIT='face-match-v1'
ROOT=Path(__file__).resolve().parents[2]

class ProofService:
    def __init__(self, settings):
        self.directory=Path(settings.proof_directory).resolve()
        self.node=settings.node_binary
        self.slots=threading.BoundedSemaphore(2)
        manifest=json.loads((self.directory/'manifest.json').read_text())
        if manifest.get('circuit')!=CIRCUIT or manifest.get('scheme')!=SCHEME:
            raise ValueError('Unsupported proof artifacts')
        from urllib.parse import urlparse
        if manifest.get('developmentOnly') and urlparse(settings.origin).hostname not in ('localhost','127.0.0.1'):
            raise ValueError('Development proof ceremony is restricted to local origins')
        source=ROOT/'zk/circuits/face_match.circom'
        if hashlib.sha256(source.read_bytes()).hexdigest()!=manifest['sourceHash']:
            raise ValueError('Circuit source differs from proving setup; rebuild explicitly')
        for name in ['face_match_js/face_match.wasm','face_match.zkey','verification_key.json','face_match.r1cs']:
            if hashlib.sha256((self.directory/name).read_bytes()).hexdigest()!=manifest['files'][name]:
                raise ValueError('Proof artifact integrity check failed: '+name)
        self.setup_id=manifest['files']['verification_key.json']
        self.assets=json.loads((self.directory/'browser-manifest.json').read_text())
        for name,item in self.assets.items():
            path=(self.directory/item['path']).resolve()
            if not path.is_relative_to(self.directory) or hashlib.sha256(path.read_bytes()).hexdigest()!=item['sha256']:
                raise ValueError('Browser proof artifact integrity failure')
        self.policy_path=Path(settings.match_policy)
        self.policy()

    def policy(self):
        policy=json.loads(self.policy_path.read_text())
        threshold=policy.get('threshold')
        if policy.get('model')!=MODEL or policy.get('quantization')!=QUANTIZATION or type(threshold) not in (float,int) or not math.isfinite(threshold) or not 0<threshold<=2:
            raise ValueError('Invalid server matching policy')
        limit=math.floor((threshold*4096)**2)
        if limit<1: raise ValueError('Threshold is below circuit resolution')
        return {'threshold':threshold,'limit':str(limit),'calibrated':policy.get('calibrated') is True}

    def config(self):
        return {'enabled':True,'circuit':CIRCUIT,'scheme':SCHEME,'setup_id':self.setup_id,'development_only':True,
                'policy':self.policy(),'assets':{name:item['sha256'] for name,item in self.assets.items()}}

    def verify(self, proof, signals, expected):
        if len(signals)!=6 or any(not isinstance(v,str) or not re.fullmatch(r'0|[1-9][0-9]{0,76}',v) or int(v)>=FIELD for v in signals):
            return False
        if signals[1:]!=[expected[k] for k in ['account','nonce','enrollmentRoot','limit','modelTag']]: return False
        if not self.slots.acquire(blocking=False): raise RuntimeError('Verifier busy; retry shortly')
        try:
            result=subprocess.run([self.node,str(ROOT/'zk/scripts/verify.mjs'),str(self.directory/'verification_key.json')],input=json.dumps({'proof':proof,'publicSignals':signals}),text=True,capture_output=True,timeout=20,check=True)
            return json.loads(result.stdout).get('valid') is True
        except (subprocess.SubprocessError,ValueError,OSError):
            return False
        finally: self.slots.release()
