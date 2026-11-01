"""Independent arbitrary-precision integer oracle for JS/circuit parity tests."""
import json
from pathlib import Path

ROOT=Path(__file__).resolve().parents[2]

def infer(model,pixels):
    if len(pixels)!=1024 or any(type(x) is not int or not 0<=x<=255 for x in pixels):
        raise ValueError('Invalid pixels')
    hidden=[max(0,(sum(w*(p-128) for w,p in zip(row,pixels))+bias+128)//256)
            for row,bias in zip(model['w1'],model['b1'])]
    return [(sum(w*h for w,h in zip(row,hidden))+bias+128)//256
            for row,bias in zip(model['w2'],model['b2'])]

if __name__=='__main__':
    model=json.loads((ROOT/'client/public/zkml/model.json').read_text())
    cases=[{'name':'black','pixels':[0]*1024},{'name':'white','pixels':[255]*1024},
           {'name':'midpoint','pixels':[128]*1024},
           {'name':'ramp','pixels':[(i*37+11)%256 for i in range(1024)]},
           {'name':'checker','pixels':[255*((i+i//32)%2) for i in range(1024)]}]
    for case in cases:case['embedding']=infer(model,case['pixels'])
    print(json.dumps(cases))
