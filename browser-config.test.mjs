import {test} from 'node:test';
import assert from 'node:assert/strict';
import {browserOptions,authenticationTimeout} from './browser-config.mjs';

test('Chrome usa sandbox por defecto fuera de Docker',()=>{
 assert.deepEqual(browserOptions({}),{headless:true});
 assert.deepEqual(browserOptions({WHATSAPP_HEADLESS:'false',CHROME_PATH:'/chrome'}),{headless:false,executablePath:'/chrome'});
});
test('deshabilita el sandbox solo cuando se configura explícitamente',()=>{
 const options=browserOptions({CHROME_NO_SANDBOX:'true',CHROME_PATH:'/usr/bin/chromium'});
 assert.deepEqual(options.args,['--no-sandbox','--disable-setuid-sandbox']);
 assert.equal(options.executablePath,'/usr/bin/chromium');
});

test('autenticación espera 30 segundos por defecto y valida el valor configurado',()=>{
 assert.equal(authenticationTimeout({}),30000);
 assert.equal(authenticationTimeout({WHATSAPP_AUTH_TIMEOUT_MS:'180000'}),180000);
 for(const value of ['0','-1','abc','300001','1.5'])assert.throws(()=>authenticationTimeout({WHATSAPP_AUTH_TIMEOUT_MS:value}),/entre 30000 y 300000/);
});
