import { fileURLToPath } from 'node:url';
import * as soap from 'soap';
import { z } from 'zod';

export const TRACKING_ENDPOINT = 'https://soap.box.trimbletl.com/fleet-service/Tracking';
export const MAX_SOAP_BYTES = 20_000_000;
export class TrimbleResponseError extends Error {}
export function totalFuelUse(properties:{key:string;value:string}[]) {
  const raw=properties.find(p=>p.key.trim().toLowerCase()==='tfu')?.value.trim();
  if(!raw || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(raw))return null;
  const value=Number(raw);
  return Number.isFinite(value)?value:null;
}

/** Same timestamp shape as the C# sample, with an explicit UTC time policy. */
export function initialMark(now = Date.now()) {
  return new Date(now - 86_400_000).toISOString().slice(0, 19) + '.000';
}

const traceSchema = z.object({
  type: z.number().int(), source: z.string(), time: z.union([z.string(), z.date()]),
  coordinate: z.object({latitude:z.number().finite(), longitude:z.number().finite()}).nullish(),
  mileage:z.number().int().nullish(), heading:z.number().int().nullish(), speed:z.number().int().nullish(),
  property:z.array(z.object({key:z.string(),value:z.string()})).optional()
});
const responseSchema = z.object({return:z.object({
  mark:z.string().min(1).max(4096), more:z.boolean(), traces:z.array(traceSchema).optional()
})});

export function normalizePollResponse(value:unknown, requestedMark:string) {
  const parsed = responseSchema.safeParse(value);
  if (!parsed.success) throw new TrimbleResponseError('Nieprawidłowa odpowiedź pollTraces. Znacznik nie został przesunięty.');
  const page = parsed.data.return;
  if (page.more && page.mark === requestedMark)
    throw new TrimbleResponseError('Trimble zwrócił more=true bez zmiany mark. Pobieranie kolejnej strony wstrzymane.');
  return {
    mark:page.mark, more:page.more,
    traces:(page.traces ?? []).map(trace => {
      const time = trace.time instanceof Date ? trace.time : new Date(
        /(?:Z|[+-]\d{2}:\d{2})$/i.test(trace.time) ? trace.time : trace.time + 'Z'
      );
      if (!Number.isFinite(time.getTime())) throw new TrimbleResponseError('Nieprawidłowy czas zdarzenia pollTraces. Znacznik nie został przesunięty.');
      return {
        source:trace.source, eventTimeUtc:time.toISOString(),
        latitude:trace.coordinate?.latitude ?? null, longitude:trace.coordinate?.longitude ?? null,
        mileage:trace.mileage ?? null, type:trace.type, heading:trace.heading ?? null,
        speed:trace.speed ?? null, tfu:totalFuelUse(trace.property??[]), properties:trace.property ?? []
      };
    })
  };
}

export async function pollTraces(credentials:Record<string,string>, mark:string, endpoint:string, timeoutSeconds:number) {
  // Snapshot of the public Trimble WSDL; credentials are never sent while loading it.
  const wsdl = fileURLToPath(new URL('../wsdl/Tracking.wsdl', import.meta.url));
  const client = await soap.createClientAsync(wsdl, {
    endpoint, disableCache:true,
    customDeserializer:{dateTime:(value:string) => value}
  });
  client.setSecurity(new soap.BasicAuthSecurity(credentials.user, credentials.pass));
  const [result, rawXml] = await client.pollTracesAsync(
    {customer:credentials.idclient, mark},
    {timeout:timeoutSeconds*1000, maxContentLength:MAX_SOAP_BYTES, maxBodyLength:MAX_SOAP_BYTES}
  );
  if (typeof rawXml !== 'string' || Buffer.byteLength(rawXml) > MAX_SOAP_BYTES)
    throw new TrimbleResponseError('Odpowiedź SOAP przekracza limit 20 MB lub nie zawiera XML.');
  return {page:normalizePollResponse(result,mark), rawXml};
}
