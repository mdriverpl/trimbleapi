import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initialMark, normalizePollResponse } from '../src/trimble.js';
import { serviceSchema } from '../src/validation.js';

test('pierwszy mark jest dobą wstecz w UTC, w formacie zgodnym z przykładem C#', () => {
  assert.equal(initialMark(Date.parse('2026-10-06T12:13:14.567Z')), '2026-10-05T12:13:14.000');
});

test('mapowanie TraceData zachowuje brak pozycji, zerowy przebieg i przelicza strefę czasu', () => {
  const page = normalizePollResponse({return:{mark:'next',more:false,traces:[
    {type:1,source:'Truck-1',time:'2026-10-06T10:30:00+02:00',coordinate:{latitude:52.2,longitude:21.1},mileage:0},
    {type:2,source:'Truck-2',time:'2026-10-06T10:30:00'}
  ]}}, 'previous');
  assert.equal(page.traces[0].eventTimeUtc,'2026-10-06T08:30:00.000Z');
  assert.equal(page.traces[0].mileage,0);
  assert.equal(page.traces[1].eventTimeUtc,'2026-10-06T10:30:00.000Z');
  assert.equal(page.traces[1].latitude,null);
  assert.equal(page.traces[1].mileage,null);
});

test('pusta strona jest poprawna, wadliwa odpowiedź nie pozwala przesunąć mark', () => {
  assert.deepEqual(normalizePollResponse({return:{mark:'same',more:false}},'same'),{mark:'same',more:false,traces:[]});
  for (const value of [{},{return:{more:false}},{return:{mark:'same',more:true}},
    {return:{mark:'next',more:false,traces:[{type:1,source:'truck',time:'invalid'}]}}]) {
    assert.throws(()=>normalizePollResponse(value,'same'));
  }
});

test('schemat Trimble pozwala na 5 minut i ustawia właściwy endpoint', () => {
  const service=serviceSchema.parse({name:'Tracking',active:true,mode:'trimble',intervalSeconds:60,timeoutSeconds:300});
  assert.equal(service.endpoint,'https://soap.box.trimbletl.com/fleet-service/Tracking');
});

