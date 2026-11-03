"""Bounded Fisher search: model selection uses training identities only."""
import sys,json,argparse,hashlib
from pathlib import Path
import numpy as np
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import train
from train_fisher import calibrate
from reference import infer

def fit(pixels, labels, subjects, pca=64, shrink=.1, normalize=False):
 x=(pixels-128)/128
 mask=np.isin(labels,subjects);mean=x[mask].mean(0)
 _,_,v=np.linalg.svd(x[mask]-mean,full_matrices=False)
 v=v[:min(pca,len(x[mask])-len(subjects))]
 z=(x[mask]-mean)@v.T;y=labels[mask]
 centers=np.stack([z[y==s].mean(0) for s in subjects])
 residual=np.concatenate([z[y==s]-centers[i] for i,s in enumerate(subjects)])
 within=residual.T@residual/len(residual);n=len(v)
 cov=(1-shrink)*within+shrink*np.trace(within)/n*np.eye(n)
 ev,u=np.linalg.eigh(cov);white=(u/np.sqrt(np.maximum(ev,1e-8)))@u.T
 _,basis=np.linalg.eigh(white@np.cov(centers,rowvar=False)@white)
 projection=v.T@white@basis[:,-16:]
 for j in range(16):
  if projection[np.argmax(np.abs(projection[:,j])),j]<0:projection[:,j]*=-1
 projection/=np.sqrt(np.mean(((x[mask]-mean)@projection)**2))
 w1=np.concatenate([projection,-projection],axis=1);b1=-mean@w1
 q=lambda a:np.floor(a+.5).astype(np.int64)
 qw1,qb1=q(w1*256),q(b1*32768);qw2=np.concatenate([np.eye(16),-np.eye(16)],axis=0).astype(np.int64)*256
 bound1=128*np.abs(qw1).sum(0)+np.abs(qb1);boundh=(bound1+128)//256;bound2=boundh@np.abs(qw2)
 if max(bound1.max(),bound2.max())+128>=2**31 or boundh.max()>=65536 or ((bound2+128)//256).max()>=32768:raise ValueError('Numeric bound failure')
 model=dict(format='privface-mlp-int-v1',id=f'olivetti-fisher-pca{pca}-shrink{shrink}-v2',preprocessing='aligned-gray32-u8-v1',quantization='w256-a128-round-half-up-v1',inputSize=1024,hiddenSize=32,embeddingSize=16,weightScale=256,activationScale=128,w1=qw1.T.tolist(),b1=qb1.tolist(),w2=qw2.T.tolist(),b2=[0]*16,researchOnly=True,trainingDatasetSHA256=train.SHA)
 hidden=np.maximum(0,((pixels-128)@qw1+qb1+128)//256)
 integer=(hidden@qw2+128)//256
 floating=(x-mean)@projection
 return model,integer,floating,int(max(bound1.max(),bound2.max()))

def main():
 parser=argparse.ArgumentParser();parser.add_argument('--data-root',type=Path,required=True);parser.add_argument('--output-root',type=Path,required=True);a=parser.parse_args()
 if a.output_root.exists():parser.error('Output must be new')
 train.ROOT=a.data_root;pixels,labels=train.dataset()
 subjects=np.random.default_rng(20261101).permutation(40);training,cal=subjects[:24],subjects[24:32]
 # Search never receives calibration or old test pixels.
 mask=np.isin(labels,training);xp,yp=pixels[mask],labels[mask]
 records=[]
 for pca in [32,64,128]:
  for shrink in [.001,.01,.1]:
   folds=[]
   for i in range(4):
    val=training[i*6:(i+1)*6];tr=np.array([s for s in training if s not in val])
    _,e,_,_=fit(xp,yp,tr,pca,shrink)
    m=calibrate(e,yp,val,.0001)
    folds.append(dict(validationSubjects=val.tolist(),metrics=m))
   score=float(np.mean([1-f['metrics']['FRR'] for f in folds]))
   records.append(dict(pca=pca,shrink=shrink,trainingCVGenuineAcceptance=score,folds=folds))
   print(pca,shrink,round(score,4),flush=True)
 selected=max(records,key=lambda r:r['trainingCVGenuineAcceptance'])
 # Freeze configuration BEFORE touching calibration scores; old tests excluded.
 mask=np.isin(labels,np.concatenate([training,cal]));pixels,labels=pixels[mask],labels[mask]
 model,e,fp,bound=fit(pixels,labels,training,selected['pca'],selected['shrink'])
 for p,v in zip(pixels,e):assert infer(model,p.tolist())==v.tolist()
 encoded=(json.dumps(model,separators=(',',':'))+'\n').encode();digest=hashlib.sha256(encoded).hexdigest()
 strict=calibrate(e,labels,cal,.0001);research=calibrate(e,labels,cal,.01)
 report=dict(scope='Training-only hyperparameter selection; calibration result is not independent test accuracy',datasetSHA256=train.SHA,trainingSubjects=training.tolist(),calibrationSubjects=cal.tolist(),heldOutTestUsed=False,selectionRule='Maximum mean four-fold subject-disjoint training-validation genuine acceptance at empirical FMR cap 0.0001; ties use fixed grid order',search=records,selected={k:selected[k] for k in ['pca','shrink','trainingCVGenuineAcceptance']},modelSHA256=digest,modelJSONBytes=len(encoded),integerCalibrationStrict=strict,integerCalibrationResearch=research,floatCalibrationStrict=calibrate(fp*128,labels,cal,.0001),quantization=dict(rmse=float(np.sqrt(np.mean((e/128-fp)**2))),maxEmbeddingError=float(np.max(np.abs(e/128-fp))),maxAccumulatorBound=bound),oracleCases=len(pixels),accepted=False)
 pub=a.output_root/'client/public/zkml';pub.mkdir(parents=True);(a.output_root/'docs').mkdir()
 (pub/'model.json').write_bytes(encoded)
 (pub/'policy.json').write_text(json.dumps(dict(format='privface-zkml-policy-v1',modelSHA256=digest,limit=str(int(strict['limit'])),calibrated=False,researchDatasetCalibrated=True,purpose='M2 training-CV Fisher candidate; fresh evaluation pending'),indent=2)+'\n')
 (a.output_root/'docs/M2-accuracy-search.json').write_text(json.dumps(report,indent=2)+'\n')
 print('SELECTED',report['selected'],'CALIBRATION',strict,flush=True)
if __name__=='__main__':main()
