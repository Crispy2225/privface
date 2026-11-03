import copy
import unittest
import numpy as np
from check_m2 import assess
from train_fisher import calibrate


class M2AcceptanceTests(unittest.TestCase):
    def setUp(self):
        self.e = dict(modelSHA256='model', integerTest={'FAR':.0001,'FRR':.049}, validation=dict(freshHeldOut=True,representativeCapture=True,demographicCoverage=True,statisticalEvidenceReviewed=True))
        self.p = dict(modelSHA256='model',setupId='a'*64,checks=['Full enrollment inference proof','Full login-relation inference proof with a different crop','Malicious intermediate witness rejected by R1CS (calculator bypassed)'])
        self.b = dict(modelSHA256='model',setupId='a'*64,invalidEnrollmentRejected=True,cancellation=True,timeout=True,incompatibleTemplateRejected=True)
        self.m = dict(modelSHA256='model',setupId='a'*64,timings=[{'provingMs':1000} for _ in range(20)],memory=dict(sampledPeakBrowserTreeRSSBytes=1000000,observations=100),device={'cpu':'test fixture'})
    def result(self):
        return assess('model',self.e,self.p,self.b,self.m)['complete']
    def test_complete_evidence(self): self.assertTrue(self.result())
    def test_missing_evidence(self): self.assertFalse(assess('model',{}, {}, {}, {})['complete'])
    def test_stale_model(self):
        self.e['modelSHA256']='old'; self.assertFalse(self.result())
    def test_stale_setup(self):
        self.b['setupId']='b'*64; self.assertFalse(self.result())
    def test_correlated_or_reused_data(self):
        self.e.pop('validation'); self.assertFalse(self.result())
    def test_bad_accuracy(self):
        for key,value in [('FAR',.00011),('FRR',.05),('FAR',float('nan')),('FRR',-1)]:
            old=copy.deepcopy(self.e); self.e['integerTest'][key]=value
            self.assertFalse(self.result()); self.e=old
    def test_forged_summary_does_not_hide_slow_proofs(self):
        self.m['p95ProvingMs']=1; self.m['timings']=[{'provingMs':6000} for _ in range(20)]
        self.assertFalse(self.result())
    def test_desktop_memory_budget_boundary(self):
        self.m['memory']['sampledPeakBrowserTreeRSSBytes']=2*1024**3
        self.assertTrue(self.result())
        self.m['memory']['sampledPeakBrowserTreeRSSBytes']+=1
        self.assertFalse(self.result())
    def test_observed_desktop_memory_fits(self):
        self.m['memory']['sampledPeakBrowserTreeRSSBytes']=1314717696
        self.assertTrue(self.result())
    def test_heap_snapshot_not_memory_evidence(self):
        self.m['memory']={'jsHeapSnapshotBytes':1000}; self.assertFalse(self.result())
    def test_too_few_measurements(self):
        self.m['timings']=self.m['timings'][:2]; self.assertFalse(self.result())
    def test_threshold_ties_and_strict_cap(self):
        e=np.array([[0],[2],[1],[3]],dtype=np.int64); y=np.array([0,0,1,1])
        strict=calibrate(e,y,[0,1],.0001)
        self.assertEqual(strict['falseAccepts'],0)
        self.assertEqual(strict['falseRejects'],2)
        self.assertLess(strict['limit'],1)


if __name__ == '__main__': unittest.main()
