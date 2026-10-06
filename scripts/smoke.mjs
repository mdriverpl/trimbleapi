import { createTestDatabase } from './test-db.mjs';
import {spawn} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {createServer} from 'node:http';
import * as soap from 'soap';
import {randomBytes} from 'node:crypto';
import assert from 'node:assert/strict';
const testDb=await createTestDatabase();
const token=randomBytes(32).toString('hex');
const port=String(18000+Math.floor(Math.random()*10000)),base=`http://127.0.0.1:${port}`;
let output='';
const child=spawn(process.execPath,['backend/dist/server.js'],{env:{...process.env,PORT:port,ADMIN_TOKEN:token,ENCRYPTION_KEY:randomBytes(32).toString('hex'),DATABASE_URL:testDb.url,WORKER_COUNT:'10'},stdio:['ignore','pipe','pipe']});
child.stdout.on('data',v=>output+=v);child.stderr.on('data',v=>output+=v);
const exited=new Promise(resolve=>child.on('exit',resolve));
const soapServer=createServer();
await new Promise(resolve=>soapServer.listen(0,'127.0.0.1',resolve));
const endpoint=`http://127.0.0.1:${soapServer.address().port}/soap`;
const requests=[];
soap.listen(soapServer,'/soap',{Fleet:{FleetPort:{Fetch(args,callback){requests.push(args);if(args.idclient==='timeout')return;callback({client:args.idclient,vehicles:2});}}}},readFileSync(new URL('../backend/test/fixture.wsdl',import.meta.url),'utf8').replace('SOAP_ENDPOINT',endpoint));
async function api(path,method='GET',body){const r=await fetch(base+path,{method,headers:{Authorization:`Bearer ${token}`,...(body===undefined?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body)});assert.ok(r.ok,`${path}: ${r.status} ${await (!r.ok?r.text():Promise.resolve(''))}`);return r.status===204?null:r.json();}
try{
 let ready=false;
 for(let i=0;i<100;i++){try{if((await fetch(base+'/health')).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,100));}
 assert.ok(ready,output);
 assert.equal((await fetch(base+'/api/status')).status,401);
 assert.equal((await fetch(base+'/')).status,200);
 await api('/api/control','PUT',{enabled:false});
 const svc=await api('/api/services','POST',{name:'Demo test',mode:'demo',active:true,intervalSeconds:60,timeoutSeconds:5});
 const ids=[];
 for(let i=0;i<12;i++)ids.push((await api('/api/workers','POST',{name:`Worker ${i}`,idclient:`client-${i}`,user:'test',pass:'hidden-secret',active:true,serviceId:svc.id})).id);
 let state=await api('/api/status');assert.equal(state.capacity,10);assert.equal(state.running,0);assert.equal(state.workers.length,12);assert.ok(!JSON.stringify(state).includes('hidden-secret'));
 await api('/api/control','PUT',{enabled:true});
 let results=[];
 for(let i=0;i<150;i++){state=await api('/api/status');assert.ok(state.running<=10);results=await api('/api/runs');if(results.length===12)break;await new Promise(r=>setTimeout(r,100));}
 assert.equal(results.length,12);assert.ok(results.every(r=>r.success===true));
 const latest=await api('/api/data/'+ids[0]);assert.equal(latest.payload.demo,true);assert.equal(latest.payload.idclient,'client-0');
 await api('/api/control','PUT',{enabled:false});
 const rejected=await fetch(base+`/api/workers/${ids[0]}/run`,{method:'POST',headers:{Authorization:`Bearer ${token}`}});assert.equal(rejected.status,409);
 await api('/api/workers/'+ids[0],'DELETE');assert.equal((await api('/api/runs?workerId='+ids[0])).length,0);
 const realService=await api('/api/services','POST',{name:'SOAP fixture',mode:'soap',active:true,wsdl:endpoint+'?wsdl',operation:'Fetch',auth:'parameters',parameters:{idclient:'{{idclient}}',user:'{{user}}',pass:'{{pass}}'},intervalSeconds:60,timeoutSeconds:5});
 const soapWorker=await api('/api/workers','POST',{name:'SOAP test',idclient:'soap-client',user:'soap-user',pass:'soap-secret',active:true,serviceId:realService.id});
 const hanging=await api('/api/workers','POST',{name:'Timeout test',idclient:'timeout',user:'test',pass:'test',active:true,serviceId:realService.id});
 await api('/api/control','PUT',{enabled:true});
 let running;
 for(let i=0;i<40;i++){running=(await api('/api/workers')).find(w=>w.id===hanging.id);if(running.status==='running')break;await new Promise(r=>setTimeout(r,100));}
 assert.equal(running.status,'running');
 const paused=await api('/api/workers/'+hanging.id+'/active','PATCH',{active:false});
 assert.equal(paused.active,false);assert.equal(paused.status,'running');
 const before=(await api('/api/workers')).find(w=>w.id===hanging.id);
 assert.equal(before.mark,running.mark);assert.equal(before.nextRun,running.nextRun);
 let history=[];
 for(let i=0;i<150;i++){history=await api('/api/runs?workerId='+hanging.id);if(history.length)break;await new Promise(r=>setTimeout(r,100));}
 assert.equal(history[0]?.success,false);
 const soapData=await api('/api/data/'+soapWorker.id);assert.equal(soapData.payload.client,'soap-client');assert.equal(soapData.payload.vehicles,2);
 assert.ok(requests.some(r=>r.user==='soap-user'&&r.pass==='soap-secret'));
 const failed=(await api('/api/workers')).find(w=>w.id===hanging.id);assert.equal(failed.failures,1);assert.ok(failed.nextRun>Date.now());
 assert.equal(failed.active,false);
 await api('/api/workers/'+hanging.id+'/active','PATCH',{active:true});
 const resumed=(await api('/api/workers')).find(w=>w.id===hanging.id);
 assert.equal(resumed.failures,failed.failures);assert.equal(resumed.nextRun,failed.nextRun);
 for(const [id,body,expected] of [[hanging.id,{active:'yes'},400],[2147483647,{active:false},404]]){
  const response=await fetch(base+`/api/workers/${id}/active`,{method:'PATCH',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(body)});
  assert.equal(response.status,expected);
 }
 await api('/api/workers/'+hanging.id,'PUT',{name:'Recovered',idclient:'recovered',user:'test',active:true,serviceId:realService.id});
 for(let i=0;i<100;i++){history=await api('/api/runs?workerId='+hanging.id);if(history[0]?.success)break;await new Promise(r=>setTimeout(r,100));}
 assert.equal(history[0]?.success,true);
 console.log('PASS: auth, static panel, 12 accounts / 10 threads, demo, pause, deletion, real SOAP XML, timeout, retry recovery.');
}finally{child.kill();await exited;soapServer.closeAllConnections();await new Promise(resolve=>soapServer.close(resolve));await testDb.close();}
