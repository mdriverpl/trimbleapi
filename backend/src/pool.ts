import { Worker } from 'node:worker_threads';
import type { Database } from './db.js';
import { decrypt } from './security.js';
import type { Service } from './validation.js';
import { initialMark } from './trimble.js';
import { nextPollDelay,applyWorkerPauses } from './schedule.js';
import { updateCurrentVehicles } from './vehicles.js';
type Job={id:number;started:number;service:Service;timer:NodeJS.Timeout};
type Slot={thread:Worker;job?:Job;finishing?:Promise<void>;retired:boolean};
type Result={success:boolean;payload?:string;error?:string;rawXml?:string;nextMark?:string;more?:boolean;traceCount?:number};
export class Pool {
  slots:Slot[]=[];
  stopped=false;
  private timer:NodeJS.Timeout;
  private ticking?:Promise<void>;
  private pending=new Set<Promise<void>>();
  constructor(private db:Database,private key:Buffer,count:number,private onFatal:()=>void){
    for(let i=0;i<count;i++)this.slots.push(this.spawn());
    this.timer=setInterval(()=>{void this.tick();},1000);
  }
  async enabled(){return (await this.db.get("SELECT value FROM settings WHERE key='enabled'"))?.value==='true';}
  private track(task:Promise<void>){
    const safe=task.catch(()=>{this.stopped=true;this.onFatal();});
    this.pending.add(safe);
    void safe.finally(()=>this.pending.delete(safe));
    return safe;
  }
  private spawn():Slot {
    const slot:Slot={thread:new Worker(new URL('./soap-worker.js',import.meta.url)),retired:false};
    slot.thread.on('message',result=>{void this.track(this.finish(slot,result));});
    slot.thread.on('error',()=>{slot.retired=true;void this.track(this.finish(slot,{success:false,error:'Proces roboczy zakończył się błędem.'}));});
    slot.thread.on('exit',()=>{
      slot.retired=true;
      void this.track(this.finish(slot,{success:false,error:'Proces roboczy został zatrzymany.'}).then(()=>{
        if(!this.stopped){const index=this.slots.indexOf(slot);if(index>=0)this.slots[index]=this.spawn();}
      }));
    });
    return slot;
  }
  private finish(slot:Slot,result:Result):Promise<void>{
    if(slot.finishing)return slot.finishing;
    const job=slot.job;if(!job)return Promise.resolve();
    clearTimeout(job.timer);
    // A slot stays occupied until COMMIT. Exit/error events share this promise.
    const task=this.db.transaction(async tx=>{
      const previous=await tx.get('SELECT failures FROM workers WHERE id=$1 FOR UPDATE',[job.id]);
      const now=Date.now(),failures=result.success?0:Number(previous?.failures??0)+1;
      const nextRun=now+nextPollDelay(job.service,result.success,result.traceCount,failures);
      if(result.success && job.service.mode==='trimble' && result.payload) {
        await updateCurrentVehicles(tx,job.id,JSON.parse(result.payload).traces,now);
      }
      await tx.run('INSERT INTO runs("workerId",started,finished,success,error,payload,"rawXml") VALUES($1,$2,$3,$4,$5,$6,$7)',
        [job.id,job.started,now,result.success,result.error??null,result.payload??null,result.rawXml??null]);
      await tx.run(`UPDATE workers SET status=$1,"lastRun"=$2,"lastSuccess"=CASE WHEN $3 THEN $2 ELSE "lastSuccess" END,
        failures=$4,error=$5,"nextRun"=$6,mark=COALESCE($7,mark) WHERE id=$8`,
        [result.success?'idle':'error',now,result.success,failures,result.error??null,nextRun,result.success?result.nextMark??null:null,job.id]);
      await tx.run('DELETE FROM runs WHERE "workerId"=$1 AND id NOT IN (SELECT id FROM runs WHERE "workerId"=$1 ORDER BY id DESC LIMIT 100)',[job.id]);
    });
    slot.finishing=task.then(()=>{slot.job=undefined;slot.finishing=undefined;});
    return slot.finishing;
  }
  tick():Promise<void>{
    if(this.stopped)return Promise.resolve();
    if(this.ticking)return this.ticking;
    this.ticking=this.track(this.dispatch()).finally(()=>{this.ticking=undefined;});
    return this.ticking;
  }
  private async dispatch(){
    while(!this.stopped){
      const slot=this.slots.find(s=>!s.job&&!s.retired);if(!slot)return;
      const claimed=await this.db.transaction(async tx=>{
        if((await tx.get("SELECT value FROM settings WHERE key='enabled'"))?.value!=='true')return;
        const row=await tx.get(`SELECT w.*,s.config FROM workers w JOIN services s ON s.id=w."serviceId"
          WHERE w.active AND w.status!='running' AND w."nextRun"<=$1 AND s.config->>'active'='true'
          ORDER BY w."nextRun",w.id LIMIT 1 FOR UPDATE OF w SKIP LOCKED`,[Date.now()]);
        if(!row)return;
        const service=applyWorkerPauses({...row.config,id:row.serviceId} as Service,row);
        const mark=service.mode==='trimble'?row.mark||initialMark():row.mark;
        await tx.run("UPDATE workers SET status='running',mark=$1 WHERE id=$2",[mark,row.id]);
        return {row,service,mark};
      });
      if(!claimed)return;
      const {row,service,mark}=claimed;
      const timer=setTimeout(()=>{
        slot.retired=true;
        void this.track(this.finish(slot,{success:false,error:'Przekroczono limit czasu SOAP.'}));
        void slot.thread.terminate();
      },service.timeoutSeconds*1000+1000);
      slot.job={id:row.id,started:Date.now(),service,timer};
      if(this.stopped||slot.retired){await this.finish(slot,{success:false,error:'Zatrzymano pobieranie przed uruchomieniem.'});return;}
      try{slot.thread.postMessage({service,mark,credentials:{idclient:row.idclient,user:row.user,pass:decrypt(row.secret,this.key)}});}
      catch{await this.finish(slot,{success:false,error:'Nie można odczytać hasła. Zapisz je ponownie.'});}
    }
  }
  async close(){
    this.stopped=true;clearInterval(this.timer);await this.ticking;
    await Promise.all(this.slots.map(s=>s.thread.terminate()));
    await Promise.all([...this.pending]);
  }
}
