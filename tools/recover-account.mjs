// Run only as the local project operator, while the local database is running.
import {readFile} from 'node:fs/promises'
import {spawnSync} from 'node:child_process'
if(!process.argv[2])throw new Error('Usage: node tools/recover-account.mjs USERNAME')
const root=new URL('../',import.meta.url).pathname
const config=JSON.parse(await readFile(new URL('../data/local-config.json',import.meta.url)))
const result=spawnSync(root+'server/.venv/bin/python',['-m','app.admin',process.argv[2]],{cwd:root,env:{...process.env,PYTHONPATH:root+'server',DATABASE_URL:`postgresql+psycopg://privface:${config.password}@127.0.0.1:${config.port}/privface`},stdio:'inherit'})
process.exit(result.status??1)
