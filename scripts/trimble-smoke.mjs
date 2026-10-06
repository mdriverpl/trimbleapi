import { createTestDatabase } from './test-db.mjs';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';
import * as soap from 'soap';

const testDb=await createTestDatabase();
const token=randomBytes(32).toString('hex'), key=randomBytes(32).toString('hex');
const port=18000+Math.floor(Math.random()*10000), base=`http://127.0.0.1:${port}`;
const remote=createServer();
await new Promise(resolve=>remote.listen(0,'127.0.0.1',resolve));
const endpoint=`http://127.0.0.1:${remote.address().port}/Tracking`;
const wsdl=readFileSync(new URL('../backend/wsdl/Tracking.wsdl',import.meta.url),'utf8')
  .replace('https://soap.box.trimbletl.com/fleet-service/Tracking',endpoint);
const requests=[];
let failSecondPage=true;
soap.listen(remote,'/Tracking',{TrackingService:{TrackingPort:{pollTraces(args,callback,headers,req){
  requests.push({args,authorization:req.headers.authorization,at:Date.now()});
  if(args.customer==='broken')return callback({return:{more:false}});
  if(args.customer==='stalled')return callback({return:{mark:args.mark,more:true}});
  if(args.customer==='large')return callback({return:{mark:'large-next',more:false,traces:[{type:1,source:'x'.repeat(20_000_001),time:'2026-10-06T10:00:00Z'}]}});
  if(args.customer==='fresh')return callback({return:{mark:'fresh-next',more:false}});
  if(args.customer==='empty-more')return callback({return:{mark:'empty-next',more:true}});
  if(args.customer==='data-final')return callback({return:{mark:'final-next',more:false,traces:[{type:1,source:'truck',time:'2026-10-06T10:00:00Z'}]}});
  if(args.mark==='page-1' && failSecondPage)throw {Fault:{faultcode:'Server',faultstring:'Test failure'}};
  if(args.mark==='page-1')return callback({return:{mark:'page-2',more:false}});
  if(args.mark==='page-2')return callback({return:{mark:'page-3',more:false}});
  callback({return:{mark:'page-1',more:true,traces:[{type:1,source:args.customer,time:'2026-10-06T10:00:00+02:00',coordinate:{latitude:52.2,longitude:21.1},mileage:123456,speed:45,property:[{key:'TFU',value:'123.45'}]}]}});
}}}},wsdl);
let child,exited,logs='';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn,label) {for(let i=0;i<200;i++){const value=await fn();if(value)return value;await sleep(100);}throw Error('Timeout: '+label+'\n'+logs);}
async function start(){
  child=spawn(process.execPath,['backend/dist/server.js'],{env:{...process.env,PORT:String(port),ADMIN_TOKEN:token,ENCRYPTION_KEY:key,DATABASE_URL:testDb.url,WORKER_COUNT:'2'},stdio:['ignore','pipe','pipe']});
  exited=new Promise(resolve=>child.on('exit',resolve));
  child.stdout.on('data',s=>logs+=s);child.stderr.on('data',s=>logs+=s);
  await until(async()=>{try{return (await fetch(base+'/health')).ok;}catch{return false;}},'backend startup');
}
async function stop(){if(child){child.kill();await exited;child=undefined;}}
async function api(path,method='GET',body){
  const r=await fetch(base+'/api'+path,{method,headers:{Authorization:`Bearer ${token}`,...(body===undefined?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body)});
  assert.ok(r.ok,`${path}: ${r.status} ${!r.ok?await r.text():''}`);
  return r.status===204?null:r.json();
}
try {
  await start();
  const service=await api('/services','POST',{name:'Trimble Tracking',mode:'trimble',endpoint,active:true,intervalSeconds:60,timeoutSeconds:5});
  const account={name:'Customer A',idclient:'customer-A',user:'basic-user',pass:'basic-secret',active:true,serviceId:service.id};
  const worker=await api('/workers','POST',{...account,mark:'2026-10-05T00:00:00.000'});
  const failed=await until(async()=>{const w=(await api('/workers')).find(w=>w.id===worker.id);return w.failures?w:false;},'second page fails');
  assert.equal(failed.mark,'page-1');
  assert.equal(requests[0].args.customer,'customer-A');
  assert.equal(requests[0].args.mark,'2026-10-05T00:00:00.000');
  assert.equal(requests[0].authorization,'Basic '+Buffer.from('basic-user:basic-secret').toString('base64'));
  assert.equal(requests[0].args.user,undefined);assert.equal(requests[0].args.pass,undefined);
  const first=await api('/data/'+worker.id);
  assert.ok(requests[1].at-first.finished>=3000,'Next SOAP request must wait at least three seconds after a nonempty response.');
  assert.equal(first.payload.traces[0].eventTimeUtc,'2026-10-06T08:00:00.000Z');
  assert.equal(first.payload.traces[0].mileage,123456);
  const vehicles=await api('/vehicles?workerId='+worker.id+'&source=customer-A');
  assert.equal(vehicles.length,1);assert.equal(vehicles[0].lat,52.2);assert.equal(vehicles[0].speed,45);
  assert.equal(vehicles[0].tfu,123.45);assert.equal(vehicles[0].read_at,'2026-10-06T08:00:00.000Z');
  assert.equal((await fetch(base+'/api/vehicles')).status,401);
  assert.match((await api('/runs/'+first.id)).rawXml,/pollTracesResponse/);
  assert.equal((await api('/runs?workerId='+worker.id)).length,2);
  // Restart with the same database: the successful page cursor must survive.
  await stop(); await start();
  assert.equal((await api('/workers')).find(w=>w.id===worker.id).mark,'page-1');
  assert.equal((await api('/vehicles?workerId='+worker.id))[0].tfu,123.45);
  failSecondPage=false;
  await api('/workers/'+worker.id+'/run','POST');
  await until(async()=>((await api('/workers')).find(w=>w.id===worker.id).mark==='page-2'),'retry second page');
  const emptyPageWorker=(await api('/workers')).find(w=>w.id===worker.id);
  assert.equal(emptyPageWorker.nextRun-emptyPageWorker.lastRun,180000);
  assert.deepEqual((await api('/data/'+worker.id)).payload.traces,[]);
  assert.equal((await api('/vehicles?workerId='+worker.id)).length,1);
  const unchanged={...account,name:'Renamed'};delete unchanged.pass;
  await api('/workers/'+worker.id,'PUT',{...unchanged,active:false});
  assert.equal((await api('/workers')).find(w=>w.id===worker.id).mark,'page-2');
  await api('/workers/'+worker.id,'PUT',{...unchanged,idclient:'new-customer',active:false});
  assert.equal((await api('/workers')).find(w=>w.id===worker.id).mark,'');
  assert.equal((await api('/vehicles?workerId='+worker.id)).length,0);
  for(const customer of ['broken','stalled','large']){
    const w=await api('/workers','POST',{...account,idclient:customer,mark:'unchanged'});
    const failed=await until(async()=>{const row=(await api('/workers')).find(v=>v.id===w.id);return row.failures?row:false;},customer+' rejected');
    assert.equal(failed.mark,'unchanged');
    assert.equal((await api('/runs?workerId='+w.id))[0].success,false);
  }
  const before=Date.now();
  const fresh=await api('/workers','POST',{...account,idclient:'fresh'});
  await until(async()=>((await api('/workers')).find(w=>w.id===fresh.id).mark==='fresh-next'),'initial mark');
  const initial=requests.find(r=>r.args.customer==='fresh').args.mark;
  assert.match(initial,/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.000$/);
  assert.ok(Math.abs(Date.parse(initial+'Z')-(before-86_400_000))<5000);
  for(const [customer,expected] of [['empty-more',180000],['data-final',3000]]){
    const w=await api('/workers','POST',{...account,idclient:customer,mark:'start'});
    const done=await until(async()=>{const row=(await api('/workers')).find(v=>v.id===w.id);return row.lastSuccess?row:false;},customer);
    assert.equal(done.nextRun-done.lastRun,expected,'Delay depends on actual data, not more.');
  }
  console.log('PASS: PostgreSQL, real Trimble WSDL, Basic auth, customer mapping, 3s/3min polling, faults, restart, UTC, raw XML, 20 MB limit, invalid response, account change.');
} finally {
  await stop();remote.closeAllConnections();await new Promise(resolve=>remote.close(resolve));
  await testDb.close();
}
