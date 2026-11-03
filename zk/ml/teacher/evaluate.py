import os
import sys,json,numpy as np
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]));from train_fisher import calibrate
p=Path(os.environ['TEACHER_CACHE']);d=json.loads((p/'embeddings.json').read_text());e=np.array(d['embeddings']);y=np.array(d['labels']);s=np.random.default_rng(20261101).permutation(40)
r={'scope':'Pretrained teacher on 32x32 grayscale development crops, not held-out accuracy','teacher':'local face-api.js ResNet recognition encoder','heldOutTestUsed':False,'strict':calibrate(e,y,s[24:32],.0001),'research':calibrate(e,y,s[24:32],.01)}
(p/'report.json').write_text(json.dumps(r,indent=2));print(json.dumps(r,indent=2))
