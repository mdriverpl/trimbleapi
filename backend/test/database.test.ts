import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { createTestDatabase } from '../../scripts/test-db.mjs';

test('PostgreSQL: migracja, rollback, równoległe transakcje, blokada instancji i restart',
  {skip:!process.env.TEST_DATABASE_URL},async()=>{
    const testDb=await createTestDatabase();
    let db=await openDb(testDb.url);
    try {
      const service=await db.get('INSERT INTO services(config) VALUES($1) RETURNING id',[JSON.stringify({active:true})]);
      const worker=await db.get('INSERT INTO workers(name,idclient,"user",secret,"serviceId",mark) VALUES($1,$2,$3,$4,$5,$6) RETURNING id',["O'Brien",'1','user','secret',service!.id,'old']);
      const id=worker!.id;
      await assert.rejects(db.transaction(async tx=>{
        await tx.run('INSERT INTO runs("workerId",started,finished,success,payload) VALUES($1,$2,$3,true,$4)',[id,Date.now(),Date.now(),JSON.stringify({test:true})]);
        await tx.run('UPDATE workers SET mark=$1 WHERE id=$2',['new',id]);
        throw new Error('Intentional rollback');
      }),/Intentional rollback/);
      assert.equal((await db.get('SELECT mark FROM workers WHERE id=$1',[id]))?.mark,'old');
      assert.equal((await db.get('SELECT count(*) AS n FROM runs'))?.n,0);
      await Promise.all(Array.from({length:10},()=>db.transaction(async tx=>{
        await tx.run('UPDATE workers SET failures=failures+1 WHERE id=$1',[id]);
      })));
      assert.equal((await db.get('SELECT failures FROM workers WHERE id=$1',[id]))?.failures,10);
      await assert.rejects(openDb(testDb.url),/aktywną instancję/);
      // Simulate an existing v1 installation; new migration must preserve its accounts.
      await db.run('DROP TABLE vehicle_current; ALTER TABLE workers DROP COLUMN "dataIntervalSeconds"; ALTER TABLE workers DROP COLUMN "emptyIntervalSeconds"; DELETE FROM schema_migrations WHERE version IN (2,3)');
      await db.run("UPDATE workers SET status='running',mark=$1 WHERE id=$2",['persisted',id]);
      await db.close();db=await openDb(testDb.url);
      const row=await db.get('SELECT * FROM workers WHERE id=$1',[id]);
      assert.equal(row?.mark,'persisted');assert.equal(row?.status,'idle');assert.equal(row?.name,"O'Brien");
      assert.equal(row?.dataIntervalSeconds,null);assert.equal(row?.emptyIntervalSeconds,null);
      assert.equal((await db.get('SELECT config FROM services WHERE id=$1',[service!.id]))?.config.active,true);
      assert.equal((await db.get('SELECT count(*) AS n FROM schema_migrations'))?.n,3);
    }finally{await db.close();await testDb.close();}
  });
