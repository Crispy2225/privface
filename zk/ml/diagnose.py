"""Calibration-only model diagnostics. Never reads held-out test embeddings."""
import importlib.util,json,argparse
from pathlib import Path
import numpy as np
ROOT=Path(__file__).resolve().parents[2]
parser=argparse.ArgumentParser()
parser.add_argument('--data-root',type=Path,default=ROOT)
parser.add_argument('--output',type=Path,default=ROOT/'docs/M2-calibration-diagnostics.json')
args=parser.parse_args()
spec=importlib.util.spec_from_file_location('training',ROOT/'zk/ml/train.py')
t=importlib.util.module_from_spec(spec);spec.loader.exec_module(t)
t.ROOT=args.data_root
pixels,labels=t.dataset()
rng=np.random.default_rng(20261101);subjects=rng.permutation(40)
train,cal=subjects[:24],subjects[24:32]
ti=np.isin(labels,train);ci=np.isin(labels,cal)
# Remove held-out subjects before all representation fitting and scoring.
keep=ti|ci;pixels=pixels[keep];labels=labels[keep];ti=np.isin(labels,train)
x=(pixels-128)/128;mean=x[ti].mean(0)
_,_,v=np.linalg.svd(x[ti]-mean,full_matrices=False)
records=[]
def record(name,e):
 m=t.metrics(e,labels,cal)
 records.append({'candidate':name,'calibration':m})
for dimensions in [16,32,64]:
 z=(x-mean)@v[:dimensions].T
 record('PCA '+str(dimensions),z)
 if dimensions==64:
  zt=z[ti];yt=labels[ti]
  centers=np.stack([zt[yt==s].mean(0) for s in train])
  residual=np.concatenate([zt[yt==s]-centers[i] for i,s in enumerate(train)])
  within=residual.T@residual/len(residual)
  between=np.cov(centers,rowvar=False)
  for shrink in [0.1,0.5,0.9]:
   covariance=(1-shrink)*within+shrink*np.trace(within)/64*np.eye(64)
   ev,u=np.linalg.eigh(covariance);whiten=(u/np.sqrt(np.maximum(ev,1e-8)))@u.T
   _,basis=np.linalg.eigh(whiten@between@whiten)
   for dims in [16,23]:record(f'PCA64/Fisher{dims}/shrink{shrink}',z@whiten@basis[:,-dims:])
report={'scope':'calibration-only diagnostic; these are linear statistical baselines, not new zkML models','trainingSubjects':train.tolist(),'calibrationSubjects':cal.tolist(),'heldOutTestUsed':False,'candidates':records,'decision':'Do not replace the deployed research model from these results alone. A selected neural candidate still needs quantization, proof setup, and fresh held-out evaluation.'}
args.output.write_text(json.dumps(report,indent=2)+'\n')
for r in records:print(r['candidate'],round(r['calibration']['FAR'],4),round(r['calibration']['FRR'],4))
