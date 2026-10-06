import pg from 'pg';
import { readFile } from 'node:fs/promises';

// Epoch milliseconds are BIGINT in PostgreSQL and safe integers in JavaScript.
pg.types.setTypeParser(20, value => {
  const result=Number(value);
  if(!Number.isSafeInteger(result))throw new Error('Liczba poza zakresem JavaScript.');
  return result;
});
export class Queries {
  constructor(protected connection:pg.Pool|pg.PoolClient) {}
  async all<T extends pg.QueryResultRow=pg.QueryResultRow>(sql:string,values:unknown[]=[]):Promise<T[]> {
    return (await this.connection.query<T>(sql,values)).rows;
  }
  async get<T extends pg.QueryResultRow=pg.QueryResultRow>(sql:string,values:unknown[]=[]):Promise<T|undefined> {
    return (await this.all<T>(sql,values))[0];
  }
  async run(sql:string,values:unknown[]=[]) {return (await this.connection.query(sql,values)).rowCount??0;}
}
export class Database extends Queries {
  constructor(private pool:pg.Pool,private lock:pg.PoolClient){super(pool);}
  async transaction<T>(work:(tx:Queries)=>Promise<T>):Promise<T> {
    const client=await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result=await work(new Queries(client));
      await client.query('COMMIT');
      return result;
    } catch(error){await client.query('ROLLBACK');throw error;}
    finally{client.release();}
  }
  async close(){this.lock.release(true);await this.pool.end();}
}
export async function openDb(connectionString:string) {
  if(!/^postgres(?:ql)?:\/\//.test(connectionString))throw new Error('Ustaw DATABASE_URL dla PostgreSQL.');
  const pool=new pg.Pool({connectionString,max:15,connectionTimeoutMillis:5000,statement_timeout:30000});
  pool.on('error',()=>console.error('Utracono bezczynne połączenie PostgreSQL.'));
  let lock:pg.PoolClient|undefined;
  try {
    lock=await pool.connect();
    const result=await lock.query('SELECT pg_try_advisory_lock(849201,1) AS acquired');
    if(!result.rows[0].acquired)throw new Error('Ta baza ma już aktywną instancję aplikacji.');
    lock.on('error',()=>{console.error('Utracono blokadę harmonogramu PostgreSQL. Zatrzymano aplikację.');process.exit(1);});
    const db=new Database(pool,lock);
    const migration=await readFile(new URL('../migrations/001_initial.sql',import.meta.url),'utf8');
    await db.transaction(async tx=>{
      await tx.run(migration);
      if(!await tx.get('SELECT version FROM schema_migrations WHERE version=2')) {
        await tx.run(await readFile(new URL('../migrations/002_vehicle_current.sql',import.meta.url),'utf8'));
      }
      if(!await tx.get('SELECT version FROM schema_migrations WHERE version=3')) {
        await tx.run(await readFile(new URL('../migrations/003_worker_pauses.sql',import.meta.url),'utf8'));
      }
      await tx.run("UPDATE workers SET status='idle' WHERE status='running'");
    });
    return db;
  }catch(error){lock?.release(true);await pool.end();throw error;}
}
