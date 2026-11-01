"""M3 adapter checks; signed-out proof-to-session integration is M4."""
import json
import os
from pathlib import Path
import pytest
from app.zkml_service import ZkMLVerifier

ROOT=Path(__file__).resolve().parents[2]

@pytest.fixture
def payload():
    path=ROOT/'zk/artifacts-ml/test-proof.json'
    if not path.exists():
        pytest.skip('Run npm --prefix zk run test:ml to generate the M3 proof fixture')
    return json.loads(path.read_text())

def verify(service,p):
    return service.verify(p['proof'],p['publicSignals'],expected=p['expected'],setup_id=p['setupId'])

def test_full_inference_adapter_and_context(payload):
    service=ZkMLVerifier(os.getenv('NODE_BINARY','node'))
    assert verify(service,payload)
    assert not verify(service,{**payload,'expected':{**payload['expected'],'nonce':'42'}})
    assert not verify(service,{**payload,'setupId':'retired'})
    assert not verify(service,{**payload,'proof':{}})

def test_verifier_resource_limits(payload):
    service=ZkMLVerifier(os.getenv('NODE_BINARY','node'))
    assert not verify(service,{**payload,'proof':{'padding':'x'*32769}})
    service.slots.acquire();service.slots.acquire()
    try:
        with pytest.raises(RuntimeError,match='busy'):verify(service,payload)
    finally:
        service.slots.release();service.slots.release()
