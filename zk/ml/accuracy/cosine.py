"""Direction-matching diagnostic; not compatible with the existing distance circuit."""
import argparse,json
from pathlib import Path
import numpy as np
from metric import train,fit,tune,embeddings
SCALE=1000000

def score_pairs(e,labels,subjects):
 idx=np.flatnonzero(np.isin(labels,subjects));e=e[idx].tolist();y=labels[idx];scores=[];genuine=[]
 for i in range(len(e)):
  for j in range(i+1,len(e)):
   dot=sum(a*b for a,b in zip(e[i],e[j]));na=sum(a*a for a in e[i]);nb=sum(b*b for b in e[j])
   scores.append(SCALE*dot*dot//(na*nb) if dot>0 and na and nb else -1)
   genuine.append(y[i]==y[j])
 return np.array(scores),np.array(genuine)

def measure(e,labels,subjects):
 scores,genuine=score_pairs(e,labels,subjects)
 candidates=np.unique(scores[genuine]);allowed=[v for v in candidates if v>=0 and np.mean(scores[~genuine]>=v)<=.0001]
 threshold=int(min(allowed)) if allowed else SCALE+1
 return dict(threshold=threshold,genuinePairs=int(genuine.sum()),impostorPairs=int((~genuine).sum()),falseAccepts=int(np.sum(scores[~genuine]>=threshold)),falseRejects=int(np.sum(scores[genuine]<threshold)),genuineAcceptance=float(np.mean(scores[genuine]>=threshold)))

def main():
 p=argparse.ArgumentParser();p.add_argument('--data-root',type=Path,required=True);p.add_argument('--output',type=Path,required=True);a=p.parse_args()
 train.ROOT=a.data_root;pixels,labels=train.dataset();subjects=np.random.default_rng(20261101).permutation(40);tr,cal=subjects[:24],subjects[24:32]
 mask=np.isin(labels,tr);xp,yp=pixels[mask],labels[mask];records=[]
 for kind in ['fisher','qat']:
  folds=[]
  for i in range(4):
   val=tr[i*6:(i+1)*6];ts=np.array([s for s in tr if s not in val]);m,_,_,_=fit(xp,yp,ts,128,.1)
   if kind=='qat':m=tune(m,xp,yp,ts,.0001,'triplet',steps=(100,))[100]
   folds.append(measure(embeddings(m,xp),yp,val))
  score=float(np.mean([f['genuineAcceptance'] for f in folds]));records.append(dict(model=kind,trainingCVGenuineAcceptance=score,folds=folds));print(kind,score,flush=True)
 chosen=max(records,key=lambda r:r['trainingCVGenuineAcceptance'])
 mask=np.isin(labels,np.concatenate([tr,cal]));pixels,labels=pixels[mask],labels[mask];m,_,_,_=fit(pixels,labels,tr,128,.1)
 if chosen['model']=='qat':m=tune(m,pixels,labels,tr,.0001,'triplet',steps=(100,))[100]
 result=measure(embeddings(m,pixels),labels,cal)
 a.output.write_text(json.dumps(dict(scope='Integer direction-matching diagnostic, not an implemented proof relation',search=records,selected=chosen['model'],calibration=result,heldOutTestUsed=False,scale=SCALE,rule='dot > 0 AND SCALE * dot^2 >= threshold * normA_squared * normB_squared',accepted=False),indent=2)+'\n')
 print('SELECTED',chosen['model'],'CALIBRATION',result,flush=True)
if __name__=='__main__':main()
