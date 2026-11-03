"""Training-only robustness experiment, fixed 4-fold selection."""
import inspect,json,argparse,hashlib
from pathlib import Path
import numpy as np
import search
from search import train,calibrate,infer

def augmented(pixels,labels,kind):
 views=[pixels]
 if kind in ['lighting','both']:
  views += [np.clip(pixels+d,0,255) for d in [-24,24]]
  views += [np.clip(np.floor((pixels-128)*s+128+.5),0,255).astype(np.int64) for s in [.8,1.2]]
 if kind in ['shift','both']:
  im=pixels.reshape(-1,32,32);pad=np.pad(im,((0,0),(1,1),(1,1)),mode='edge')
  views += [pad[:,1+dy:33+dy,1+dx:33+dx].reshape(-1,1024) for dy,dx in [(0,-1),(0,1),(-1,0),(1,0)]]
 return np.concatenate(views),np.tile(labels,len(views))

# Same export/integer contract as the Fisher search; only fitting data changes.
src=inspect.getsource(search.fit).replace('normalize=False','normalize=False, augmentation="none"')
src=src.replace(' mask=np.isin(labels,subjects);mean=x[mask].mean(0)', ''' mask=np.isin(labels,subjects)
 ap,ay=augmented(pixels[mask],labels[mask],augmentation)
 ax=(ap-128)/128;mean=ax.mean(0)''').replace('np.linalg.svd(x[mask]-mean','np.linalg.svd(ax-mean').replace('len(x[mask])-len(subjects)','len(ax)-len(subjects)').replace('z=(x[mask]-mean)@v.T;y=labels[mask]','z=(ax-mean)@v.T;y=ay')
exec(src,globals())

def main():
 p=argparse.ArgumentParser();p.add_argument('--data-root',type=Path,required=True);p.add_argument('--output-root',type=Path,required=True);a=p.parse_args()
 if a.output_root.exists():p.error('Output must be new')
 train.ROOT=a.data_root;pixels,labels=train.dataset();subjects=np.random.default_rng(20261101).permutation(40);tr,cal=subjects[:24],subjects[24:32]
 mask=np.isin(labels,tr);xp,yp=pixels[mask],labels[mask];records=[]
 for augmentation in ['none','lighting','shift','both']:
  folds=[]
  for i in range(4):
   val=tr[i*6:(i+1)*6];ts=np.array([s for s in tr if s not in val])
   _,e,_,_=fit(xp,yp,ts,128,.1,augmentation=augmentation);m=calibrate(e,yp,val,.0001);folds.append(m)
  score=float(np.mean([1-f['FRR'] for f in folds]));records.append(dict(augmentation=augmentation,trainingCVGenuineAcceptance=score,folds=folds));print(augmentation,score,flush=True)
 chosen=max(records,key=lambda r:r['trainingCVGenuineAcceptance'])
 mask=np.isin(labels,np.concatenate([tr,cal]));pixels,labels=pixels[mask],labels[mask]
 model,e,fp,bound=fit(pixels,labels,tr,128,.1,augmentation=chosen['augmentation']);model['id']='olivetti-robust-fisher-'+chosen['augmentation']+'-v1'
 for pix,v in zip(pixels,e):assert infer(model,pix.tolist())==v.tolist()
 raw=(json.dumps(model,separators=(',',':'))+'\n').encode();digest=hashlib.sha256(raw).hexdigest();strict=calibrate(e,labels,cal,.0001)
 report=dict(scope='Training-only augmentation selection; calibration is not held-out test accuracy',modelSHA256=digest,modelJSONBytes=len(raw),datasetSHA256=train.SHA,trainingSubjects=tr.tolist(),calibrationSubjects=cal.tolist(),heldOutTestUsed=False,search=records,selected=chosen['augmentation'],integerCalibrationStrict=strict,integerCalibrationResearch=calibrate(e,labels,cal,.01),floatCalibrationStrict=calibrate(fp*128,labels,cal,.0001),quantization=dict(rmse=float(np.sqrt(np.mean((e/128-fp)**2))),maxAccumulatorBound=bound),oracleCases=len(pixels),accepted=False)
 pub=a.output_root/'client/public/zkml';pub.mkdir(parents=True);(a.output_root/'docs').mkdir();(pub/'model.json').write_bytes(raw)
 (pub/'policy.json').write_text(json.dumps(dict(format='privface-zkml-policy-v1',modelSHA256=digest,limit=str(int(strict['limit'])),calibrated=False,researchDatasetCalibrated=True,purpose='M2 robustness candidate; fresh validation pending'),indent=2)+'\n')
 (a.output_root/'docs/M2-accuracy-augmentation.json').write_text(json.dumps(report,indent=2)+'\n')
 print('SELECTED',chosen['augmentation'],'CALIBRATION',strict,flush=True)
if __name__=='__main__':main()
