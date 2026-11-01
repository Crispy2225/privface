// Explicit operator action after reviewing participant results; never automatic.
import {readFile,writeFile,copyFile,rename} from 'node:fs/promises'
import {evaluate} from '../src/calibration.ts'
import {EMBEDDING_MODEL} from '../src/template-crypto.ts'
import {QUANTIZATION} from '../src/face-match.ts'
const [datasetPath,reportPath,flag]=process.argv.slice(2)
if(!datasetPath||!reportPath||flag!=='--apply-reviewed')throw new Error('Usage: node --experimental-strip-types scripts/apply-policy.mjs PRIVATE_DATASET REVIEWED_REPORT --apply-reviewed')
const dataset=JSON.parse(await readFile(datasetPath,'utf8'))
const reportFile=JSON.parse(await readFile(reportPath,'utf8')),report=reportFile.baseline??reportFile
const computed=evaluate(dataset,report.targetFAR)
if(JSON.stringify(computed)!==JSON.stringify(report))throw new Error('Report does not match this dataset and evaluator. Regenerate and review it.')
if(computed.policy.model!==EMBEDDING_MODEL||computed.policy.quantization!==QUANTIZATION||computed.heldOut.FAR>computed.targetFAR)throw new Error('Held-out FAR exceeds the selected target. Collect/review more data; do not tune using test subjects.')
const target=new URL('../src/match-policy.json',import.meta.url)
const backup=new URL('../src/match-policy.previous.json',import.meta.url)
await copyFile(target,backup)
const temporary=new URL('../src/match-policy.pending.json',import.meta.url)
await writeFile(temporary,JSON.stringify(computed.policy,null,2)+'\n')
await rename(temporary,target)
console.log('Installed reviewed baseline policy. Previous policy saved as match-policy.previous.json. Rebuild the client; new proof challenges use the current server policy immediately. This does not establish population accuracy.')
