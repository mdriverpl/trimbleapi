import { test } from 'node:test';
import assert from 'node:assert/strict';
import { soapErrorMessage } from '../src/soap-errors.js';

test('Błędy SOAP wskazują przyczynę bez ujawniania XML i haseł',()=>{
  for(const [error,expected] of [
    [{response:{status:401}},'HTTP 401'],[{response:{status:403}},'HTTP 403'],
    [{response:{status:429}},'HTTP 429'],[{response:{status:503}},'HTTP 503'],
    [{code:'ETIMEDOUT'},'czas oczekiwania'],[{code:'ENOTFOUND'},'DNS'],
    [{code:'ERR_BAD_RESPONSE',message:'maxContentLength size exceeded'},'rozmiar'],
    [{root:{Envelope:{Body:{Fault:{faultstring:'password=secret'}}}}},'SOAP Fault']
  ] as const){
    const result=soapErrorMessage({...error,request:'password=secret'},true);
    assert.ok(result.includes(expected));assert.ok(!result.includes('password=secret'));
    assert.ok(result.includes('mark nie został przesunięty'));
  }
  assert.ok(!soapErrorMessage({message:'password=secret'},true).includes('secret'));
});
