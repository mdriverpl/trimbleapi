import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { openDb } from './db.js';
import { encrypt,validToken } from './security.js';
import { serviceSchema,workerSchema } from './validation.js';
import { Pool } from './pool.js';
const token=process.env.ADMIN_TOKEN??'',keyHex=process.env.ENCRYPTION_KEY??'';
if(token.length<24||!/^[a-f0-9]{64}$/i.test(keyHex))throw new Error('Ustaw ADMIN_TOKEN (min. 24 znaki) oraz ENCRYPTION_KEY (64 znaki hex).');
const key=Buffer.from(keyHex,'hex'),count=Number(process.env.WORKER_COUNT??10);
if(!Number.isInteger(count)||count<1||count>32)throw new Error('WORKER_COUNT musi wynosić 1–32.');
const db=await openDb(process.env.DATABASE_URL??'');
const app=Fastify({logger:{redact:['req.headers.authorization']},bodyLimit:100_000});
const pool=new Pool(db,key,count,()=>{app.log.error('Błąd zapisu lub harmonogramu PostgreSQL. Zatrzymano aplikację; mark nie zostanie pominięty.');process.exit(1);});
app.addHook('onRequest',async(req,reply)=>{
  if(req.routeOptions.url?.startsWith('/api/')&&!validToken(req.headers.authorization??'',`Bearer ${token}`))return reply.code(401).send({error:'Nieprawidłowy token administratora.'});
});
app.setErrorHandler((error,req,reply)=>{
  const e=error as {name?:string;statusCode?:number;code?:string;message?:string};
  if(e.name==='ZodError')return reply.code(400).send({error:'Nieprawidłowe dane formularza.'});
  if(e.code==='23503')return reply.code(409).send({error:'Powiązany wpis nie istnieje lub jest nadal używany.'});
  if(e.statusCode&&e.statusCode<500)return reply.code(e.statusCode).send({error:e.message??'Nieprawidłowe żądanie.'});
  req.log.error({errorType:e.name},'Błąd serwera');return reply.code(500).send({error:'Błąd wewnętrzny serwera.'});
});
const services=async()=>(await db.all('SELECT * FROM services ORDER BY id')).map(r=>({id:r.id,...serviceSchema.parse(r.config)}));
const workers=()=>db.all('SELECT id,name,idclient,"user",active,"serviceId",status,"nextRun","lastRun","lastSuccess",failures,error,mark,"dataIntervalSeconds","emptyIntervalSeconds" FROM workers ORDER BY id');
function fail(statusCode:number,message:string):never{throw Object.assign(new Error(message),{statusCode});}
function idOf(req:{params:unknown}){const id=Number((req.params as {id:string}).id);if(!Number.isInteger(id)||id<1||id>2147483647)fail(400,'Nieprawidłowy identyfikator.');return id;}
app.get('/health',async(_req,reply)=>{try{await db.get('SELECT 1');return pool.stopped?reply.code(503).send({status:'unavailable'}):{status:'ok'};}catch{return reply.code(503).send({status:'unavailable'});}});
app.get('/api/status',async()=>({enabled:await pool.enabled(),capacity:count,running:pool.slots.filter(s=>s.job).length,uptime:Math.round(process.uptime()),workers:await workers(),services:await services()}));
app.put('/api/control',async(req)=>{const enabled=(req.body as {enabled?:unknown})?.enabled;if(typeof enabled!=='boolean')fail(400,'Wymagane enabled: boolean.');await db.run("UPDATE settings SET value=$1 WHERE key='enabled'",[String(enabled)]);return {enabled};});
app.get('/api/services',services);
app.post('/api/services',async(req,reply)=>{const data=serviceSchema.parse(req.body);const r=await db.get('INSERT INTO services(config) VALUES($1) RETURNING id',[JSON.stringify(data)]);return reply.code(201).send({id:r!.id,...data});});
app.put('/api/services/:id',async(req)=>{
  const data=serviceSchema.parse(req.body),id=idOf(req);
  return db.transaction(async tx=>{
    const existing=await tx.get('SELECT config FROM services WHERE id=$1 FOR UPDATE',[id]);if(!existing)fail(404,'Brak usługi.');
    const old=serviceSchema.parse(existing.config);
    const changed=old.mode!==data.mode||old.endpoint!==data.endpoint||old.wsdl!==data.wsdl||old.operation!==data.operation;
    if(changed&&await tx.get('SELECT id FROM workers WHERE "serviceId"=$1',[id]))fail(409,'Usługa ma przypisane konta. Utwórz nową usługę i przenieś workery; ich mark zostanie zresetowany.');
    await tx.run('UPDATE services SET config=$1 WHERE id=$2',[JSON.stringify(data),id]);return {id,...data};
  });
});
app.delete('/api/services/:id',async(req,reply)=>{const n=await db.run('DELETE FROM services WHERE id=$1',[idOf(req)]);return reply.code(n?204:404).send();});
app.get('/api/workers',workers);
app.patch('/api/workers/:id/active',async(req)=>{
  const active=(req.body as {active?:unknown})?.active;
  if(typeof active!=='boolean')fail(400,'Wymagane active: boolean.');
  // Preserve credentials, cursor, failures and schedule, including an in-flight job.
  const row=await db.get('UPDATE workers SET active=$1 WHERE id=$2 RETURNING id,active,status',[active,idOf(req)]);
  return row??fail(404,'Brak workera.');
});
app.post('/api/workers',async(req,reply)=>{
  const data=workerSchema.parse(req.body);
  const r=await db.get('INSERT INTO workers(name,idclient,"user",secret,active,"serviceId",mark,"dataIntervalSeconds","emptyIntervalSeconds") VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id',[data.name,data.idclient,data.user,encrypt(data.pass??'',key),data.active,data.serviceId,data.mark??'',data.dataIntervalSeconds??null,data.emptyIntervalSeconds??null]);
  return reply.code(201).send({id:r!.id});
});
app.put('/api/workers/:id',async(req)=>{
  const id=idOf(req),data=workerSchema.parse(req.body);
  return db.transaction(async tx=>{
    const old=await tx.get('SELECT * FROM workers WHERE id=$1 FOR UPDATE',[id]);if(!old)fail(404,'Brak workera.');
    if(old.status==='running')fail(409,'Poczekaj na zakończenie bieżącego pobierania.');
    const changed=old.idclient!==data.idclient||old.serviceId!==data.serviceId,mark=data.mark??(changed?'':old.mark);
    if(changed)await tx.run('DELETE FROM vehicle_current WHERE worker_id=$1',[id]);
    await tx.run(`UPDATE workers SET name=$1,idclient=$2,"user"=$3,secret=$4,active=$5,"serviceId"=$6,mark=$7,"nextRun"=0,status='idle',failures=0,error=NULL,
      "dataIntervalSeconds"=$9,"emptyIntervalSeconds"=$10 WHERE id=$8`,[data.name,data.idclient,data.user,data.pass===undefined?old.secret:encrypt(data.pass,key),data.active,data.serviceId,mark,id,
      data.dataIntervalSeconds===undefined?old.dataIntervalSeconds:data.dataIntervalSeconds,
      data.emptyIntervalSeconds===undefined?old.emptyIntervalSeconds:data.emptyIntervalSeconds]);return {id};
  });
});
app.delete('/api/workers/:id',async(req,reply)=>{
  await db.transaction(async tx=>{const id=idOf(req),row=await tx.get('SELECT status FROM workers WHERE id=$1 FOR UPDATE',[id]);if(!row)fail(404,'Brak workera.');if(row.status==='running')fail(409,'Worker aktualnie pobiera dane.');await tx.run('DELETE FROM workers WHERE id=$1',[id]);});return reply.code(204).send();
});
app.post('/api/workers/:id/run',async(req,reply)=>{
  await db.transaction(async tx=>{
    const id=idOf(req),row=await tx.get('SELECT w.*,s.config FROM workers w JOIN services s ON s.id=w."serviceId" WHERE w.id=$1 FOR UPDATE OF w',[id]);if(!row)fail(404,'Brak workera.');
    const enabled=(await tx.get("SELECT value FROM settings WHERE key='enabled'"))?.value==='true';
    if(!enabled||!row.active||!row.config.active||row.status==='running')fail(409,'Włącz pobieranie, usługę i workera; poczekaj na zakończenie bieżącego zadania.');
    await tx.run('UPDATE workers SET "nextRun"=0 WHERE id=$1',[id]);
  });void pool.tick();return reply.code(202).send({queued:true});
});
app.get('/api/runs',async(req)=>{
  const q=req.query as {workerId?:string;limit?:string},limit=q.limit===undefined?50:Number(q.limit);
  if(!Number.isInteger(limit)||limit<1||limit>100)fail(400,'Limit musi wynosić 1–100.');
  const columns='id,"workerId",started,finished,success,error';
  return q.workerId!==undefined?db.all(`SELECT ${columns} FROM runs WHERE "workerId"=$1 ORDER BY id DESC LIMIT $2`,[idOf({params:{id:q.workerId}}),limit]):db.all(`SELECT ${columns} FROM runs ORDER BY id DESC LIMIT $1`,[limit]);
});
app.get('/api/runs/:id',async(req)=>{const r=await db.get('SELECT * FROM runs WHERE id=$1',[idOf(req)]);return r??fail(404,'Brak wyniku.');});
app.get('/api/data/:id',async(req)=>{const r=await db.get('SELECT id,"workerId",finished,payload FROM runs WHERE "workerId"=$1 AND success ORDER BY id DESC LIMIT 1',[idOf(req)]);return r??fail(404,'Brak pobranych danych.');});
app.get('/api/vehicles',async(req)=>{
  const q=req.query as {workerId?:string;source?:string;limit?:string;offset?:string};
  const limit=q.limit===undefined?100:Number(q.limit),offset=q.offset===undefined?0:Number(q.offset);
  if(!Number.isInteger(limit)||limit<1||limit>500||!Number.isSafeInteger(offset)||offset<0)fail(400,'Nieprawidłowa paginacja. Limit: 1–500.');
  const workerId=q.workerId===undefined?null:idOf({params:{id:q.workerId}});
  return db.all(`SELECT v.*,w.name AS worker_name,w.idclient FROM vehicle_current v JOIN workers w ON w.id=v.worker_id
    WHERE ($1::integer IS NULL OR v.worker_id=$1) AND ($2::text IS NULL OR v.source=$2)
    ORDER BY v.read_at DESC,v.worker_id,v.source LIMIT $3 OFFSET $4`,[workerId,q.source??null,limit,offset]);
});
const web=fileURLToPath(new URL('../../frontend/dist/',import.meta.url));
if(existsSync(web))await app.register(fastifyStatic,{root:web});
app.addHook('onClose',async()=>{await pool.close();await db.close();});
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{void app.close();});
try{await app.listen({port:Number(process.env.PORT??3000),host:'0.0.0.0'});}catch(error){await app.close();throw error;}
