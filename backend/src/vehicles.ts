import type { Queries } from './db.js';
import type { normalizePollResponse } from './trimble.js';
type Trace = ReturnType<typeof normalizePollResponse>['traces'][number];

/** Latest complete trace per vehicle; do not combine fields from different readings. */
export async function updateCurrentVehicles(tx:Queries,workerId:number,traces:Trace[],receivedAt:number) {
  const latest=new Map<string,Trace>();
  for(const trace of traces) {
    const old=latest.get(trace.source);
    if(!old || Date.parse(trace.eventTimeUtc)>Date.parse(old.eventTimeUtc))latest.set(trace.source,trace);
  }
  if(!latest.size)return;
  const rows=[...latest.values()].sort((a,b)=>a.source.localeCompare(b.source)).map(trace=>({
    source:trace.source,lat:trace.latitude,lon:trace.longitude,speed:trace.speed,
    read_at:trace.eventTimeUtc,mileage:trace.mileage,heading:trace.heading,
    trace_type:trace.type,tfu:trace.tfu,properties:trace.properties
  }));
  // Same transaction as the raw response and cursor. Strictly newer timestamps win.
  await tx.run(`INSERT INTO vehicle_current(worker_id,source,lat,lon,speed,read_at,received_at,mileage,heading,trace_type,tfu,properties)
    SELECT $1,r.source,r.lat,r.lon,r.speed,r.read_at,$3,r.mileage,r.heading,r.trace_type,r.tfu,r.properties
    FROM jsonb_to_recordset($2::jsonb) AS r(source text,lat double precision,lon double precision,speed integer,
      read_at timestamptz,mileage bigint,heading integer,trace_type integer,tfu double precision,properties jsonb)
    ON CONFLICT(worker_id,source) DO UPDATE SET lat=EXCLUDED.lat,lon=EXCLUDED.lon,speed=EXCLUDED.speed,
      read_at=EXCLUDED.read_at,received_at=EXCLUDED.received_at,mileage=EXCLUDED.mileage,
      heading=EXCLUDED.heading,trace_type=EXCLUDED.trace_type,tfu=EXCLUDED.tfu,properties=EXCLUDED.properties
    WHERE EXCLUDED.read_at>vehicle_current.read_at`,[workerId,JSON.stringify(rows),new Date(receivedAt).toISOString()]);
}
