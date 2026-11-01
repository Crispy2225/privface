// Persistent local PostgreSQL + migrations + development API/client.
import EmbeddedPostgres from 'embedded-postgres'
import {readFile,writeFile,mkdir,access,chmod} from 'node:fs/promises'
import {randomBytes} from 'node:crypto'
import {spawn} from 'node:child_process'
import {fileURLToPath} from 'node:url'
import path from 'node:path'
const webPort=Number(process.env.PRIVFACE_WEB_PORT||5173), apiPort=Number(process.env.PRIVFACE_API_PORT||8000)
if(![webPort,apiPort].every(n=>Number.isInteger(n)&&n>=1024&&n<=65535))throw new Error('Invalid local port')
if(process.argv.includes('--invite'))throw new Error('Invitations are no longer used. Register a username and password in the app.')
const root=fileURLToPath(new URL('../',import.meta.url))
const data=path.join(root,'data');await mkdir(data,{recursive:true,mode:0o700});await chmod(data,0o700)
const configPath=path.join(data,'local-config.json')
let config
try{config=JSON.parse(await readFile(configPath,'utf8'))}catch(e){if(e.code!=='ENOENT')throw e;config={port:15432,password:randomBytes(32).toString('hex')};await writeFile(configPath,JSON.stringify(config),{mode:0o600,flag:'wx'})}
const databaseDir=path.join(data,'postgres')
const pg=new EmbeddedPostgres({databaseDir,port:config.port,user:'privface',password:config.password,authMethod:'scram-sha-256',persistent:true,postgresFlags:['-h','127.0.0.1','-k',data],onLog:()=>{},onError:()=>{}})
let started=false,stopping=false;const children=[]
async function stop(){if(stopping)return;stopping=true;for(const child of children)child.kill('SIGTERM');await Promise.all(children.map(child=>child.exitCode!==null?Promise.resolve():new Promise(resolve=>{child.once('exit',resolve);setTimeout(()=>{child.kill('SIGKILL');resolve()},3000).unref()})));if(started)await pg.stop()}
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>void stop().then(()=>process.exit(0)))
const env={...process.env,DATABASE_URL:`postgresql+psycopg://privface:${config.password}@127.0.0.1:${config.port}/privface`,APP_ORIGIN:`http://localhost:${webPort}`,API_PROXY_TARGET:`http://127.0.0.1:${apiPort}`,PROOF_ENABLED:'true',NODE_BINARY:process.execPath,PYTHONPATH:path.join(root,'server'),PATH:path.dirname(process.execPath)+path.delimiter+process.env.PATH}
function run(binary,args,cwd=root){return new Promise((resolve,reject)=>{const child=spawn(binary,args,{cwd,env,stdio:'inherit'});child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(new Error('Setup command failed: '+args[0])))})}
const python=path.join(root,'server/.venv/bin/python')
try{
  try{await access(path.join(databaseDir,'PG_VERSION'))}catch{await pg.initialise()}
  await pg.start();started=true
  const client=pg.getPgClient('postgres');await client.connect()
  const exists=await client.query("SELECT 1 FROM pg_database WHERE datname='privface'");await client.end()
  if(!exists.rowCount)await pg.createDatabase('privface')
  await run(python,['-m','alembic','-c','server/alembic.ini','upgrade','head'])
  if(process.argv.includes('--check-persistence')){
    const marker=randomBytes(16).toString('hex');let c=pg.getPgClient('privface');await c.connect()
    await c.query('CREATE TABLE IF NOT EXISTS local_persistence_check (id text PRIMARY KEY)');await c.query('INSERT INTO local_persistence_check VALUES ($1)',[marker]);await c.end()
    await pg.stop();started=false;await pg.start();started=true;c=pg.getPgClient('privface');await c.connect()
    if(!(await c.query('SELECT id FROM local_persistence_check WHERE id=$1',[marker])).rowCount)throw new Error('Persistence check failed')
    await c.query('DELETE FROM local_persistence_check WHERE id=$1',[marker]);await c.end();console.log('PASS: PostgreSQL data survives a clean stop and restart.')
  }
  if(process.argv.includes('--setup-only')){await stop();process.exit(0)}
  try{await access(path.join(root,'zk/artifacts/manifest.json'))}catch{await run(process.execPath,['scripts/setup.mjs'],path.join(root,'zk'))}
  await run(process.execPath,['scripts/prepare-browser.mjs'],path.join(root,'zk'))
  await run(process.execPath,['scripts/prepare-vision.mjs'],path.join(root,'client'));await run(process.execPath,['scripts/prepare-recognition.mjs'],path.join(root,'client'))
  await run(process.execPath,['scripts/quantize-recognition.mjs','public/vision/recognition-int8'],path.join(root,'client'))
  for(const [binary,args,cwd] of [[python,['-m','uvicorn','app.main:app','--host','127.0.0.1','--port',String(apiPort)],root],[process.execPath,['node_modules/vite/bin/vite.js','--host','localhost','--port',String(webPort),'--strictPort','--configLoader','runner'],path.join(root,'client')]]){
    const child=spawn(binary,args,{cwd,env,stdio:'inherit'});children.push(child);child.once('error',()=>void stop());child.once('exit',()=>{if(!stopping)void stop()})
  }
  console.log(`PrivFace: http://localhost:${webPort} · collection: http://localhost:${webPort}/study · Ctrl+C stops services and preserves data.`)
}catch(error){await stop();console.error(error.message);process.exitCode=1}
