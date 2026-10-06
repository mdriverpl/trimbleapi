import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { encrypt,decrypt,validToken } from '../src/security.js';
import { serviceSchema } from '../src/validation.js';
import { resolveParameters } from '../src/soap-worker.js';
test('hasła są szyfrowane, odczytywalne tylko właściwym kluczem, a modyfikacje wykrywane',()=>{
 const key=randomBytes(32),secret='sekret-SOAP-123',encoded=encrypt(secret,key);
 assert.ok(!encoded.includes(secret));assert.equal(decrypt(encoded,key),secret);
 assert.notEqual(encoded,encrypt(secret,key));assert.throws(()=>decrypt(encoded,randomBytes(32)));
 assert.equal(validToken('abc','abc'),true);assert.equal(validToken('abc','abcd'),false);
});
test('parametry zagnieżdżone podstawiają dane konkretnego konta',()=>{
 assert.deepEqual(resolveParameters({auth:{client:'{{idclient}}',password:'{{pass}}'},items:['{{user}}',3]}, {idclient:'42',user:'tester',pass:'secret'}),{auth:{client:'42',password:'secret'},items:['tester',3]});
});
test('SOAP wymaga poprawnej konfiguracji i ograniczonego interwału',()=>{
 const base={name:'test',active:true,mode:'soap',wsdl:'https://example.org/wsdl',operation:'Fetch',intervalSeconds:60,timeoutSeconds:30};
 assert.ok(serviceSchema.safeParse(base).success);
 for(const change of [{wsdl:'file:///etc/passwd'},{operation:''},{intervalSeconds:0},{timeoutSeconds:500}])assert.equal(serviceSchema.safeParse({...base,...change}).success,false);
});
