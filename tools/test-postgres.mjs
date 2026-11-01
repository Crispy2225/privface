// Always creates a disposable database; never reads the application's credentials.
import EmbeddedPostgres from 'embedded-postgres'
import {spawn} from 'node:child_process'
import {randomBytes} from 'node:crypto'
import {mkdtemp} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {fileURLToPath} from 'node:url'
const root=fileURLToPath(new URL('../',import.meta.url)),directory=await mkdtemp(tmpdir()+'/privface-test-')
const password=randomBytes(24).toString('hex')
const pg=new EmbeddedPostgres({databaseDir:directory+'/cluster',user:'privface_test',password,port:15433,persistent:false,authMethod:'scram-sha-256',postgresFlags:['-h','127.0.0.1','-k',directory],onLog:()=>{},onError:()=>{}})
await pg.initialise()
try{
 await pg.start();await pg.createDatabase('privface_test')
 const url=`postgresql+psycopg://privface_test:${password}@127.0.0.1:15433/privface_test`
 const run=args=>new Promise((resolve,reject)=>{const child=spawn(root+'server/.venv/bin/python',args,{cwd:root,env:{...process.env,DATABASE_URL:url,TEST_DATABASE_URL:url,PYTHONPATH:root+'server',NODE_BINARY:process.execPath},stdio:'inherit'});child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(new Error('PostgreSQL check failed')))})
 await run(['-m','alembic','-c','server/alembic.ini','upgrade','head'])
 await run(['-m','alembic','-c','server/alembic.ini','check'])
 await run(['-m','pytest','server/tests','-q'])
 console.log('PASS: PostgreSQL migrations, schema consistency, and API integration suite.')
}finally{await pg.stop()}
