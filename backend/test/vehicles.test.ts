import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { updateCurrentVehicles } from '../src/vehicles.js';
import { normalizePollResponse,totalFuelUse } from '../src/trimble.js';
import { createTestDatabase } from '../../scripts/test-db.mjs';

test('TFU: liczba z właściwości, zero, brak i nieprawidłowa wartość',()=>{
  assert.equal(totalFuelUse([{key:'TFU',value:'1234.56'}]),1234.56);
  assert.equal(totalFuelUse([{key:'tfu',value:'0'}]),0);
  assert.equal(totalFuelUse([{key:'tfu',value:'n/a'}]),null);
  assert.equal(totalFuelUse([]),null);
});
test('PostgreSQL: bieżące pojazdy, starsze odczyty, izolacja kont i rollback',{skip:!process.env.TEST_DATABASE_URL},async()=>{
  const testDb=await createTestDatabase(),db=await openDb(testDb.url);
  const trace=(time:string,speed=20,source='vehicle-1')=>normalizePollResponse({return:{mark:'m',more:false,traces:[{
    type:1,source,time,speed,mileage:500,heading:90,coordinate:{latitude:52,longitude:21},property:[{key:'TFU',value:'25.5'}]
  }]}},'previous').traces[0];
  try{
    const service=await db.get('INSERT INTO services(config) VALUES($1) RETURNING id',['{}']);
    const ids=[];
    for(let i=0;i<2;i++)ids.push((await db.get('INSERT INTO workers(name,idclient,"user",secret,"serviceId") VALUES($1,$2,$3,$4,$5) RETURNING id',['w','client'+i,'u','s',service!.id]))!.id);
    const put=(id:number,traces:ReturnType<typeof trace>[])=>db.transaction(tx=>updateCurrentVehicles(tx,id,traces,Date.now()));
    await put(ids[0],[trace('2026-10-06T10:00:00Z',10),trace('2026-10-06T12:00:00Z',30),trace('2026-10-06T11:00:00Z',20)]);
    await put(ids[0],[trace('2026-10-06T09:00:00Z',99),trace('2026-10-06T12:00:00Z',99)]);
    const row=await db.get('SELECT * FROM vehicle_current WHERE worker_id=$1',[ids[0]]);
    assert.equal(row?.speed,30);assert.equal(row?.tfu,25.5);assert.equal(row?.lat,52);
    assert.equal(row?.read_at.toISOString(),'2026-10-06T12:00:00.000Z');
    await put(ids[1],[trace('2026-10-06T13:00:00Z',77)]);
    assert.equal((await db.get('SELECT count(*) AS n FROM vehicle_current'))?.n,2);
    await assert.rejects(db.transaction(async tx=>{
      await updateCurrentVehicles(tx,ids[0],[trace('2026-10-06T14:00:00Z',88)],Date.now());
      throw new Error('rollback');
    }));
    assert.equal((await db.get('SELECT speed FROM vehicle_current WHERE worker_id=$1',[ids[0]]))?.speed,30);
    await put(ids[0],[]);
    const missing={...trace('2026-10-06T15:00:00Z'),latitude:null,longitude:null,speed:null,tfu:null};
    await put(ids[0],[missing]);
    assert.equal((await db.get('SELECT lat FROM vehicle_current WHERE worker_id=$1',[ids[0]]))?.lat,null);
    await db.run('DELETE FROM workers WHERE id=$1',[ids[0]]);
    assert.equal((await db.get('SELECT count(*) AS n FROM vehicle_current'))?.n,1);
  }finally{await db.close();await testDb.close();}
});
