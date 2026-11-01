"""Reproduce the small M2 research model. Requires only NumPy; no camera data.

Training is offline. The browser runs the exported integer encoder only.
Dataset: AT&T Laboratories Cambridge, checksum used by scikit-learn.
"""
from pathlib import Path
import hashlib
import json
import platform
import struct
import urllib.request
import argparse
import numpy as np

ROOT = Path(__file__).resolve().parents[2]
URL = 'https://ndownloader.figshare.com/files/5976027'
SHA = 'b612fb967f2dc77c9c62d3e1266e0c73d5fca46a4b8906c18e454d41af987794'

def dataset():
    path = ROOT / 'data/zkml/olivettifaces.mat'
    path.parent.mkdir(parents=True, exist_ok=True)
    if not path.exists():
        urllib.request.urlretrieve(URL, path)
    raw = path.read_bytes()
    if hashlib.sha256(raw).hexdigest() != SHA:
        raise ValueError('Dataset checksum mismatch')
    # Read ONLY the first uint8 matrix of this pinned MATLAB v5 file.
    # No general MATLAB parser, pickle, or executable dataset format is used.
    assert raw[126:128] == b'MI'
    assert struct.unpack_from('>II', raw, 160) == (4096, 400)
    assert raw[176:181] == b'faces'
    assert struct.unpack_from('>II', raw, 184) == (2, 1638400)
    images = np.frombuffer(raw, np.uint8, 1638400, 192).reshape(400,64,64).transpose(0,2,1)
    # Exact box averaging, round half up, 64x64 -> 32x32.
    pixels = ((images.astype(np.int64).reshape(400,32,2,32,2).sum((2,4))+2)//4).reshape(400,1024)
    return pixels, np.repeat(np.arange(40),10)

def metrics(embeddings, labels, subjects, limit=None):
    ix = np.flatnonzero(np.isin(labels,subjects))
    e,y = embeddings[ix],labels[ix]
    a,b = np.triu_indices(len(ix),1)
    distances = np.sum((e[a]-e[b])**2,axis=1)
    genuine = y[a] == y[b]
    if limit is None:
        # Choose threshold on calibration identities ONLY; <=1% empirical FAR.
        candidates = np.unique(distances[genuine])
        allowed = [v for v in candidates if np.mean(distances[~genuine]<=v)<=0.01]
        limit = float(max(allowed)) if allowed else float(np.min(distances[~genuine])-1)
    return {'limit':float(limit),'genuinePairs':int(genuine.sum()),'impostorPairs':int((~genuine).sum()),
            'falseAccepts':int(np.sum(distances[~genuine]<=limit)),
            'falseRejects':int(np.sum(distances[genuine]>limit)),
            'FAR':float(np.mean(distances[~genuine]<=limit)),
            'FRR':float(np.mean(distances[genuine]>limit))}

def main(contrastive_weight=0.08):
    pixels,labels=dataset()
    rng=np.random.default_rng(20261101)
    # Freeze before fitting: 24 training, 8 calibration, 8 held-out identities.
    subjects=rng.permutation(40)
    train,cal,test=subjects[:24],subjects[24:32],subjects[32:]
    x=(pixels[np.isin(labels,train)]-128)/128
    y=labels[np.isin(labels,train)]
    # PCA initialization is learned from TRAIN identities only. Two-layer encoder
    # is then optimized by reconstruction + supervised pair contrastive loss.
    _,_,v=np.linalg.svd(x-x.mean(0),full_matrices=False)
    w1=v[:32].T.copy(); b1=-x.mean(0)@w1+0.5
    w2=rng.normal(0,0.12,(32,16)); b2=np.zeros(16)
    wd=rng.normal(0,0.04,(16,1024)); bd=x.mean(0).copy()
    params=[w1,b1,w2,b2,wd,bd]
    moment=[np.zeros_like(p) for p in params]; variance=[np.zeros_like(p) for p in params]
    positive=y[:,None]==y[None,:]; np.fill_diagonal(positive,False)
    negative=y[:,None]!=y[None,:]
    for step in range(1,601):
        pre=x@w1+b1; h=np.maximum(pre,0); e=h@w2+b2
        reconstruction=e@wd+bd
        residual=reconstruction-x
        drecon=2*residual/residual.size
        de=drecon@wd.T
        delta=e[:,None,:]-e[None,:,:]
        d=np.sqrt(np.sum(delta*delta,axis=2)+1e-8)
        # Equal weight for positive and negative populations, margin 2.
        coef=positive/positive.sum()+negative*np.minimum(0,1-2/d)/negative.sum()
        de+=contrastive_weight*4*np.sum(coef[:,:,None]*delta,axis=1)
        dh=(de@w2.T)*(pre>0)
        grads=[x.T@dh,dh.sum(0),h.T@de,de.sum(0),e.T@drecon,drecon.sum(0)]
        for j,(p,g) in enumerate(zip(params,grads)):
            g+=1e-5*p
            moment[j]=0.9*moment[j]+0.1*g
            variance[j]=0.999*variance[j]+0.001*g*g
            p-=0.001*(moment[j]/(1-0.9**step))/(np.sqrt(variance[j]/(1-0.999**step))+1e-8)
    q=lambda a:np.floor(a+0.5).astype(np.int64)
    # Weights /256, bias /32768. Hidden and embedding values /128.
    qw1,qb1,qw2,qb2=q(w1*256),q(b1*32768),q(w2*256),q(b2*32768)
    a1=(pixels-128)@qw1+qb1
    hidden=np.maximum(0,(a1+128)//256)
    a2=hidden@qw2+qb2
    integer=(a2+128)//256
    fp=np.maximum(0,((pixels-128)/128)@w1+b1)@w2+b2
    # Check all possible input bytes, not merely dataset samples.
    bound1=128*np.abs(qw1).sum(0)+np.abs(qb1)
    boundh=(bound1+128)//256
    bound2=boundh@np.abs(qw2)+np.abs(qb2)
    assert max(bound1.max(),bound2.max())+128 < 2**31
    assert boundh.max()<65536 and ((bound2+128)//256).max()<32768
    calibration=metrics(integer,labels,cal)
    report={'dataset':{'name':'Olivetti / AT&T Laboratories Cambridge','url':URL,'sha256':SHA,
                       'samples':400,'subjects':40,'scope':'Research feasibility only; not webcam or population validation'},
            'split':{'trainSubjects':train.tolist(),'calibrationSubjects':cal.tolist(),'testSubjects':test.tolist()},
            'training':{'seed':20261101,'steps':600,'loss':f'reconstruction + {contrastive_weight} * pair contrastive, margin 2','numpy':np.__version__,'python':platform.python_version()},
            'integerCalibration':calibration,'integerTest':metrics(integer,labels,test,calibration['limit']),
            'floatCalibration':metrics(fp*128,labels,cal),
            'quantization':{'maxEmbeddingError':float(np.max(np.abs(integer/128-fp))),'rmse':float(np.sqrt(np.mean((integer/128-fp)**2))),
                            'maxAccumulatorBound':int(max(bound1.max(),bound2.max()))},
            'limitations':['Small historical controlled dataset','Pair observations are correlated','No physical-camera evaluation','Not an M5 production calibration']}
    float_limit=report['floatCalibration']['limit']
    report['floatTest']=metrics(fp*128,labels,test,float_limit)
    model={'format':'privface-mlp-int-v1','id':'olivetti-mlp-32x32-32-16-v1',
           'preprocessing':'aligned-gray32-u8-v1','quantization':'w256-a128-round-half-up-v1',
           'inputSize':1024,'hiddenSize':32,'embeddingSize':16,'weightScale':256,'activationScale':128,
           'w1':qw1.T.tolist(),'b1':qb1.tolist(),'w2':qw2.T.tolist(),'b2':qb2.tolist(),
           'researchOnly':True,'trainingDatasetSHA256':SHA}
    target=ROOT/'client/public/zkml'; target.mkdir(parents=True,exist_ok=True)
    encoded=(json.dumps(model,separators=(',',':'))+'\n').encode()
    (target/'model.json').write_bytes(encoded)
    model_hash=hashlib.sha256(encoded).hexdigest()
    policy={'format':'privface-zkml-policy-v1','modelSHA256':model_hash,'limit':str(int(calibration['limit'])),
            'calibrated':False,'researchDatasetCalibrated':True,'purpose':'M2/M3 research demonstration; M5 webcam calibration pending'}
    (target/'policy.json').write_text(json.dumps(policy,indent=2)+'\n')
    report['modelSHA256']=model_hash; report['modelJSONBytes']=len(encoded)
    (ROOT/'docs').mkdir(parents=True,exist_ok=True)
    (ROOT/'docs/M2-model-experiment.json').write_text(json.dumps(report,indent=2)+'\n')
    # Private/local test material; never put research face crops in git or reports.
    probes=[int(np.flatnonzero(labels==s)[0]) for s in test[:2]]
    (ROOT/'data/zkml/fixtures.json').write_text(json.dumps({'pixels':pixels[probes].tolist(),'embeddings':integer[probes].tolist()}))
    print(json.dumps(report,indent=2))

if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--contrastive-weight',type=float,default=0.08)
    parser.add_argument('--output-root',type=Path)
    args=parser.parse_args()
    if args.output_root:ROOT=args.output_root.resolve()
    if not 0<=args.contrastive_weight<=1:parser.error('contrastive weight must be between 0 and 1')
    main(args.contrastive_weight)
