import { z } from 'zod';
export const serviceSchema = z.object({
  name: z.string().trim().min(1).max(100), active: z.boolean(), mode: z.enum(['demo','soap','trimble']),
  endpoint: z.url().refine(v => /^https?:\/\//.test(v)).default('https://soap.box.trimbletl.com/fleet-service/Tracking'),
  wsdl: z.string().max(2000).default(''), operation: z.string().max(100).default(''),
  auth: z.enum(['basic','wssecurity','parameters']).default('parameters'),
  parameters: z.record(z.string(), z.unknown()).default({}),
  intervalSeconds: z.number().int().min(10).max(86400),
  dataIntervalSeconds: z.number().int().min(1).max(86400).default(3),
  emptyIntervalSeconds: z.number().int().min(1).max(86400).default(180),
  timeoutSeconds: z.number().int().min(5).max(300)
}).superRefine((v, ctx) => {
  if (v.mode === 'soap' && (!/^https?:\/\//.test(v.wsdl) || !v.operation.trim()))
    ctx.addIssue({code:'custom', message:'SOAP wymaga adresu HTTP(S) WSDL i nazwy operacji.'});
});
export const workerSchema = z.object({name:z.string().trim().min(1).max(100), idclient:z.string().trim().min(1).max(100), user:z.string().max(200), pass:z.string().max(1000).optional(), active:z.boolean(), serviceId:z.number().int().positive(), mark:z.string().max(4096).optional(),
  dataIntervalSeconds:z.number().int().min(1).max(86400).nullable().optional(),
  emptyIntervalSeconds:z.number().int().min(1).max(86400).nullable().optional()
});
export type Service = z.infer<typeof serviceSchema> & {id:number};
