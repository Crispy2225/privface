"""Fixed-grid training-only CV for quantization-aware metric fine tuning."""
import argparse,hashlib,json,copy
from pathlib import Path
import numpy as np
import torch
from search import train,fit,calibrate,infer

torch.set_num_threads(1)

def embeddings(model,pixels):
 w1=np.array(model['w1']).T;b1=np.array(model['b1']);w2=np.array(model['w2']).T;b2=np.array(model['b2'])
 h=np.maximum(0,((pixels-128)@w1+b1+128)//256)
 return (h@w2+b2+128)//256

def validate(model):
 w1=np.array(model['w1']).T;b1=np.array(model['b1']);w2=np.array(model['w2']).T;b2=np.array(model['b2'])
 b=128*np.abs(w1).sum(0)+np.abs(b1);h=(b+128)//256;c=h@np.abs(w2)+np.abs(b2)
 if max(b.max(),c.max())+128>=2**31 or h.max()>=65536 or ((c+128)//256).max()>=32768:raise ValueError('Overflow')
 return int(max(b.max(),c.max()))

def tune(model,pixels,labels,subjects,lr,kind,steps=(50,200)):
 torch.manual_seed(20261102)
 mask=np.isin(labels,subjects);x=torch.tensor((pixels[mask]-128)/128,dtype=torch.float64);y=torch.tensor(labels[mask])
 params=[torch.nn.Parameter(torch.tensor(model[k],dtype=torch.float64)/scale) for k,scale in [('w1',256),('b1',32768),('w2',256),('b2',32768)]]
 orig=[p.detach().clone() for p in params]
 def q(x,scale):return x+(torch.floor(x*scale+.5)/scale-x).detach()
 def forward():
  w1,b1,w2,b2=params
  h=torch.relu(q(x@q(w1,256).T+q(b1,32768),128))
  return q(h@q(w2,256).T+q(b2,32768),128)
 teacher=forward().detach()
 pos=(y[:,None]==y[None,:]) & ~torch.eye(len(y),dtype=torch.bool);neg=y[:,None]!=y[None,:]
 optimizer=torch.optim.Adam(params,lr=lr);checkpoints={}
 for step in range(1,max(steps)+1):
  e=forward();d=((e[:,None]-e[None,:])**2).mean(2)
  if kind=='contrastive': loss=d[pos].mean()+torch.relu(1-d[neg]).square().mean()
  else:
   hardest=d.masked_fill(~pos,-1).max(1).values
   nearest=d.masked_fill(~neg,1e6).min(1).values
   loss=torch.relu(hardest-nearest+.5).mean()+.1*d[pos].mean()
  loss+=.05*(e-teacher).square().mean()
  loss+=.001*sum((p-o).square().mean() for p,o in zip(params,orig))
  if not torch.isfinite(loss):raise ValueError('Non-finite loss')
  optimizer.zero_grad();loss.backward();torch.nn.utils.clip_grad_norm_(params,10);optimizer.step()
  if step in steps:
   m=copy.deepcopy(model)
   for k,p,s in zip(['w1','b1','w2','b2'],params,[256,32768,256,32768]):m[k]=np.floor(p.detach().numpy()*s+.5).astype(np.int64).tolist()
   validate(m);checkpoints[step]=m
 return checkpoints

def main():
 p=argparse.ArgumentParser();p.add_argument('--data-root',type=Path,required=True);p.add_argument('--output-root',type=Path,required=True);a=p.parse_args()
 if a.output_root.exists():p.error('Output must be new')
 train.ROOT=a.data_root;pixels,labels=train.dataset();subjects=np.random.default_rng(20261101).permutation(40);tr,cal=subjects[:24],subjects[24:32]
 mask=np.isin(labels,tr);xp,yp=pixels[mask],labels[mask];records=[]
 initial=[]
 for i in range(4):
  val=tr[i*6:(i+1)*6];ts=np.array([s for s in tr if s not in val]);m,_,_,_=fit(xp,yp,ts,128,.1);initial.append((m,ts,val))
 for kind in ['triplet']:
  for lr in [.00005,.0002]:
   results={50:[],200:[]}
   for i,(m,ts,val) in enumerate(initial):
    checkpoints=tune(m,xp,yp,ts,lr,kind)
    for step,model in checkpoints.items():results[step].append(calibrate(embeddings(model,xp),yp,val,.0001))
   for step,folds in results.items():
    score=float(np.mean([1-f['FRR'] for f in folds]));records.append(dict(loss=kind,learningRate=lr,steps=step,trainingCVGenuineAcceptance=score,folds=folds));print(kind,lr,step,score,flush=True)
 best=max(records,key=lambda r:r['trainingCVGenuineAcceptance']);print('FROZEN',best['loss'],best['learningRate'],best['steps'],flush=True)
 mask=np.isin(labels,np.concatenate([tr,cal]));pixels,labels=pixels[mask],labels[mask];m,_,_,_=fit(pixels,labels,tr,128,.1)
 model=tune(m,pixels,labels,tr,best['learningRate'],best['loss'],steps=(best['steps'],))[best['steps']]
 model['id']='olivetti-qat-metric-32x32-32-16-v1';e=embeddings(model,pixels)
 for pix,v in zip(pixels,e):assert infer(model,pix.tolist())==v.tolist()
 raw=(json.dumps(model,separators=(',',':'))+'\n').encode();digest=hashlib.sha256(raw).hexdigest();strict=calibrate(e,labels,cal,.0001)
 report=dict(scope='Training-only model/epoch selection; calibration is not fresh held-out test accuracy',modelSHA256=digest,modelJSONBytes=len(raw),datasetSHA256=train.SHA,trainingSubjects=tr.tolist(),calibrationSubjects=cal.tolist(),heldOutTestUsed=False,seed=20261102,torch=torch.__version__,search=records,selected={k:best[k] for k in ['loss','learningRate','steps','trainingCVGenuineAcceptance']},integerCalibrationStrict=strict,integerCalibrationResearch=calibrate(e,labels,cal,.01),maxAccumulatorBound=validate(model),oracleCases=len(pixels),accepted=False)
 pub=a.output_root/'client/public/zkml';pub.mkdir(parents=True);(a.output_root/'docs').mkdir();(pub/'model.json').write_bytes(raw)
 (pub/'policy.json').write_text(json.dumps(dict(format='privface-zkml-policy-v1',modelSHA256=digest,limit=str(int(strict['limit'])),calibrated=False,researchDatasetCalibrated=True,purpose='M2 QAT metric candidate; fresh validation pending'),indent=2)+'\n')
 (a.output_root/'docs/M2-accuracy-metric.json').write_text(json.dumps(report,indent=2)+'\n');print('CALIBRATION',strict,flush=True)
if __name__=='__main__':main()
