import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, openSync, closeSync, unlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import net from 'node:net';
import pg from 'pg';

const root=fileURLToPath(new URL('../',import.meta.url));
process.chdir(root);
await import('./init-env.mjs');
process.loadEnvFile('.env');
const runtime=join(root,'.local-runtime'),data=join(runtime,'postgres');
mkdirSync(runtime,{recursive:true});
const port=Number(process.env.LOCAL_POSTGRES_PORT??55430),appPort=Number(process.env.PORT??3000);
const token=process.env.ADMIN_TOKEN;
const appUrl=`http://127.0.0.1:${appPort}`;
try {
  const response=await fetch(appUrl+'/api/status',{headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(1500)});
  if(response.ok){console.log(`Panel already running: http://localhost:${appPort}`);process.exit(0);}
}catch{}
async function portFree(value){return new Promise(resolve=>{const s=net.createServer();s.once('error',()=>resolve(false));s.listen(value,'127.0.0.1',()=>s.close(()=>resolve(true)));});}
if(!await portFree(appPort))throw new Error(`Port ${appPort} is in use by another application.`);
const bin=process.env.POSTGRES_BIN??['18','17'].map(v=>join(process.env.ProgramFiles??'C:/Program Files','PostgreSQL',v,'bin')).find(p=>existsSync(join(p,'postgres.exe')));
if(!bin)throw new Error('Set POSTGRES_BIN to the directory containing postgres and initdb.');
const binary=name=>join(bin,name+(process.platform==='win32'?'.exe':''));
function launch(command,args,name){
  const log=openSync(join(runtime,name+'.log'),'a');
  try{
    const child=spawn(command,args,{cwd:root,detached:true,windowsHide:true,stdio:['ignore',log,log]});
    child.on('error',()=>console.error(`Could not start ${name}; check .local-runtime logs.`));
    child.unref();
    writeFileSync(join(runtime,name+'.pid'),String(child.pid));
  }finally{closeSync(log);}
}
const password=process.env.POSTGRES_PASSWORD;
if(!password)throw new Error('POSTGRES_PASSWORD is required.');
const base=`postgresql://trimble:${encodeURIComponent(password)}@127.0.0.1:${port}`;
async function connect(database){const c=new pg.Client({connectionString:base+'/'+database,connectionTimeoutMillis:1000});try{await c.connect();return c;}catch(e){await c.end();throw e;}}
if(!existsSync(join(data,'PG_VERSION'))){
  if(!await portFree(port))throw new Error(`Port ${port} is in use. Set LOCAL_POSTGRES_PORT.`);
  const pwfile=join(runtime,'init-password.tmp');
  writeFileSync(pwfile,password,{mode:0o600});
  try{
    const result=spawnSync(binary('initdb'),['-D',data,'-U','trimble','--auth=scram-sha-256','--encoding=UTF8','--locale=C',`--pwfile=${pwfile}`],{windowsHide:true,encoding:'utf8'});
    if(result.status!==0)throw new Error('initdb failed: '+result.stderr);
  }finally{unlinkSync(pwfile);}
}
let admin;
try{admin=await connect('postgres');}catch{
  if(!await portFree(port))throw new Error('Local PostgreSQL is not accessible with the configured password.');
  launch(binary('postgres'),['-D',data,'-h','127.0.0.1','-p',String(port)],'postgres');
  for(let i=0;i<60;i++){
    try{admin=await connect('postgres');break;}catch{await new Promise(r=>setTimeout(r,500));}
  }
}
if(!admin)throw new Error('PostgreSQL did not start. See .local-runtime/postgres.log.');
try{
  const directory=await admin.query('SHOW data_directory');
  if(directory.rows[0].data_directory.replaceAll('\\','/').toLowerCase()!==data.replaceAll('\\','/').toLowerCase())throw new Error('The port belongs to a different PostgreSQL cluster.');
  if(!(await admin.query("SELECT 1 FROM pg_database WHERE datname='trimble'")).rowCount)await admin.query('CREATE DATABASE trimble');
}finally{await admin.end();}
const envPath=join(root,'.env'),previous=readFileSync(envPath,'utf8');
if(!existsSync(join(runtime,'env.before-local')))writeFileSync(join(runtime,'env.before-local'),previous,{mode:0o600});
const connectionString=base+'/trimble';
writeFileSync(envPath,previous.replace(/^DATABASE_URL=.*$/m,'DATABASE_URL='+connectionString),{mode:0o600});
process.env.DATABASE_URL=connectionString;
if(!existsSync('backend/dist/server.js')||!existsSync('frontend/dist/index.html'))throw new Error('Run npm run build first.');
launch(process.execPath,['--env-file=.env','backend/dist/server.js'],'app');
for(let i=0;i<60;i++){
  try{
    const response=await fetch(appUrl+'/api/status',{headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(1500)});
    if(response.ok){console.log(`Panel ready: http://localhost:${appPort}\nLogin token: ADMIN_TOKEN in .env\nPersistent database and logs: .local-runtime`);process.exit(0);}
  }catch{}
  await new Promise(r=>setTimeout(r,500));
}
throw new Error('Application did not start. See .local-runtime/app.log.');
