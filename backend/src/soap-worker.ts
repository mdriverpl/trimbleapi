import { parentPort } from 'node:worker_threads';
import * as soap from 'soap';
import type { Service } from './validation.js';
import { pollTraces, TRACKING_ENDPOINT, TrimbleResponseError, MAX_SOAP_BYTES } from './trimble.js';
import { soapErrorMessage } from './soap-errors.js';
export function resolveParameters(value: unknown, credentials: Record<string,string>): unknown {
  if (typeof value === 'string') return value.replace(/\{\{(idclient|user|pass)\}\}/g, (_, key: string) => credentials[key]);
  if (Array.isArray(value)) return value.map(v => resolveParameters(v, credentials));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k,v]) => [k,resolveParameters(v,credentials)]));
  return value;
}
parentPort?.on('message', async (job: {service:Service; credentials:Record<string,string>; mark?:string}) => {
  try {
    let result: unknown;
    let rawXml: string | undefined;
    let nextMark: string | undefined;
    let more = false;
    let traceCount: number | undefined;
    if (job.service.mode === 'demo') {
      await new Promise(resolve => setTimeout(resolve, 350));
      result = {demo:true, idclient:job.credentials.idclient, fetchedAt:new Date().toISOString(), vehicles:[{id:'DEMO-001', latitude:52.2297, longitude:21.0122, speed:42}]};
    } else if (job.service.mode === 'trimble') {
      if (!job.mark) throw new TrimbleResponseError('Brak początkowego znacznika workera.');
      const response = await pollTraces(job.credentials, job.mark, job.service.endpoint ?? TRACKING_ENDPOINT, job.service.timeoutSeconds);
      result = response.page;
      rawXml = response.rawXml;
      nextMark = response.page.mark;
      more = response.page.more;
      traceCount = response.page.traces.length;
    } else {
      const s = job.service;
      const client = await soap.createClientAsync(s.wsdl, {wsdl_options:{timeout:s.timeoutSeconds*1000}, disableCache:true});
      if (s.auth === 'basic') client.setSecurity(new soap.BasicAuthSecurity(job.credentials.user, job.credentials.pass));
      if (s.auth === 'wssecurity') client.setSecurity(new soap.WSSecurity(job.credentials.user, job.credentials.pass));
      const method = client[`${s.operation}Async`];
      if (typeof method !== 'function') throw new Error('Unknown operation');
      [result] = await method.call(client, resolveParameters(s.parameters, job.credentials), {timeout:s.timeoutSeconds*1000});
    }
    const payload = JSON.stringify(result ?? null);
    if (Buffer.byteLength(payload) > (job.service.mode === 'trimble' ? MAX_SOAP_BYTES : 5_000_000)) throw new TrimbleResponseError('Wynik SOAP przekracza limit rozmiaru JSON. Znacznik nie został przesunięty.');
    parentPort!.postMessage({success:true, payload, rawXml, nextMark, more, traceCount});
  } catch (error) {
    parentPort!.postMessage({success:false, error:soapErrorMessage(error,job.service.mode==='trimble')});
  }
});
