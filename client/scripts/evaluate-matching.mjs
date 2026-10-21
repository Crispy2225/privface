import { readFile, writeFile } from 'node:fs/promises'
import { evaluate } from '../src/calibration.ts'
const [input, output, far = '0.01'] = process.argv.slice(2)
if (!input || !output) throw new Error('Usage: node --experimental-strip-types scripts/evaluate-matching.mjs input.json output.json [targetFAR]')
const report = evaluate(JSON.parse(await readFile(input, 'utf8')), Number(far))
await writeFile(output, JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify({ threshold: report.policy.threshold, calibration: report.calibration, heldOut: report.heldOut, maxDistanceDrift: report.maxDistanceDrift }, null, 2))
