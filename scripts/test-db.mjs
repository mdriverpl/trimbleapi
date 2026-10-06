import pg from 'pg';
import { randomBytes } from 'node:crypto';

// Never use DATABASE_URL: tests need an explicit disposable PostgreSQL server.
export async function createTestDatabase() {
  const source=process.env.TEST_DATABASE_URL;
  if(!source)throw new Error('Set TEST_DATABASE_URL to a PostgreSQL URL with CREATEDB permission.');
  const admin=new pg.Client({connectionString:source,connectionTimeoutMillis:5000});
  await admin.connect();
  const name='trimble_test_'+randomBytes(12).toString('hex');
  const url=new URL(source);url.pathname='/'+name;
  try {await admin.query(`CREATE DATABASE "${name}"`);}
  catch(error){await admin.end();throw error;}
  return {
    url:url.toString(),
    async close(){
      try {await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);}
      finally {await admin.end();}
    }
  };
}
