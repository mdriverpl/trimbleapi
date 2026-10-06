import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextPollDelay,applyWorkerPauses } from '../src/schedule.js';
import { serviceSchema,workerSchema } from '../src/validation.js';
test('Trimble: dane = 3 sekundy, pusto = 3 minuty; błąd ma osobne ponowienie',()=>{
  const service={mode:'trimble' as const,intervalSeconds:60};
  assert.equal(nextPollDelay(service,true,1,0),3000);
  assert.equal(nextPollDelay(service,true,200,0),3000);
  assert.equal(nextPollDelay(service,true,0,0),180000);
  assert.equal(nextPollDelay(service,false,undefined,1),120000);
  assert.equal(nextPollDelay(service,false,undefined,8),960000);
  assert.equal(nextPollDelay({mode:'demo',intervalSeconds:30},true,undefined,0),30000);
});
test('Pauzy workera mają pierwszeństwo; puste wartości dziedziczą ustawienia usługi',()=>{
  const service={...serviceSchema.parse({name:'test',active:true,mode:'trimble',intervalSeconds:60,timeoutSeconds:30,dataIntervalSeconds:7,emptyIntervalSeconds:240}),id:1};
  const custom=applyWorkerPauses(service,{dataIntervalSeconds:2,emptyIntervalSeconds:60});
  assert.equal(nextPollDelay(custom,true,1,0),2000);assert.equal(nextPollDelay(custom,true,0,0),60000);
  const inherited=applyWorkerPauses(service,{dataIntervalSeconds:null,emptyIntervalSeconds:null});
  assert.equal(nextPollDelay(inherited,true,1,0),7000);assert.equal(nextPollDelay(inherited,true,0,0),240000);
  assert.equal(applyWorkerPauses(service,{dataIntervalSeconds:5}).emptyIntervalSeconds,240);
  const worker={name:'w',idclient:'c',user:'u',active:true,serviceId:1};
  assert.ok(workerSchema.safeParse({...worker,dataIntervalSeconds:null}).success);
  for(const field of ['dataIntervalSeconds','emptyIntervalSeconds'])for(const value of [0,-1,1.5,86401,'3'])assert.equal(workerSchema.safeParse({...worker,[field]:value}).success,false);
});
test('Edytowalne przerwy: zapisane wartości sterują harmonogramem, walidacja odrzuca niepoprawne',()=>{
  const config={name:'Trimble',active:true,mode:'trimble',intervalSeconds:60,timeoutSeconds:30};
  const defaults=serviceSchema.parse(config);
  assert.equal(defaults.dataIntervalSeconds,3);assert.equal(defaults.emptyIntervalSeconds,180);
  const custom=serviceSchema.parse({...config,dataIntervalSeconds:7,emptyIntervalSeconds:240});
  assert.equal(nextPollDelay(custom,true,1,0),7000);
  assert.equal(nextPollDelay(custom,true,0,0),240000);
  assert.equal(nextPollDelay(custom,false,undefined,1),120000);
  for(const field of ['dataIntervalSeconds','emptyIntervalSeconds']){
    for(const value of [0,-1,1.5,86401,'3'])assert.equal(serviceSchema.safeParse({...config,[field]:value}).success,false);
  }
});
