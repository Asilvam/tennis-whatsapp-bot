import {test} from 'node:test';
import assert from 'node:assert/strict';
import {formatLog,messageRef} from './logger.mjs';

test('muestra hora chilena, evento y referencia breve sin ID completo',()=>{
 const id='true_group@server_MESSAGE_person@lid';
 const line=formatLog('AVISO','RESULTADO_RECHAZADO','El partido no fue creado para ranking',{messageId:id,score:'6:3, 6:4'},new Date('2026-11-16T19:00:00Z'));
 assert.match(line,/16:00:00/);assert.match(line,/RESULTADO_RECHAZADO/);
 assert.ok(line.includes(messageRef(id)));assert.ok(!line.includes(id));assert.match(line,/Marcador: 6:3, 6:4/);
});

test('oculta URI, correos y credenciales Bearer en detalles de error',()=>{
 const line=formatLog('ERROR','API','mongodb+srv://user:password@host/db contacto@test.com Bearer abc123');
 assert.doesNotMatch(line,/password|contacto@test.com|abc123/);
 assert.match(line,/ocult/);
});
