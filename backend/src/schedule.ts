import type { Service } from './validation.js';
export function applyWorkerPauses(service:Service,worker:{dataIntervalSeconds?:number|null;emptyIntervalSeconds?:number|null}):Service {
  return {...service,dataIntervalSeconds:worker.dataIntervalSeconds??service.dataIntervalSeconds??3,
    emptyIntervalSeconds:worker.emptyIntervalSeconds??service.emptyIntervalSeconds??180};
}

export function nextPollDelay(service:Pick<Service,'mode'|'intervalSeconds'> & Partial<Pick<Service,'dataIntervalSeconds'|'emptyIntervalSeconds'>>,success:boolean,traceCount:number|undefined,failures:number) {
  if(success && service.mode==='trimble')return ((traceCount??0)>0?(service.dataIntervalSeconds??3):(service.emptyIntervalSeconds??180))*1000;
  return service.intervalSeconds*1000*Math.min(16,2**Math.min(failures,4));
}
