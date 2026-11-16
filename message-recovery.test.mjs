import {test} from 'node:test';
import assert from 'node:assert/strict';
import {recoverableMessage} from './message-recovery.mjs';
const message={id:{_serialized:'new'},body:'Ricardo Gallardo a Joaquín Gallardo 6/3, 4/6, 10/7 st.',timestamp:101,type:'chat'};

test('recupera un resultado nuevo omitido por los eventos de WhatsApp',()=>{
 assert.equal(recoverableMessage(message,100,{}),true);
 assert.equal(recoverableMessage(message,100,{new:{status:'pending'}}),false);
 assert.equal(recoverableMessage({...message,timestamp:99},100,{}),false);
});

test('recupera confirmaciones nuevas pero ignora respuestas del bot y mensajes comunes',()=>{
 assert.equal(recoverableMessage({...message,body:'Sí',hasQuotedMsg:true},100,{}),true);
 assert.equal(recoverableMessage({...message,body:'sí',hasQuotedMsg:false},100,{}),false);
 assert.equal(recoverableMessage({...message,body:'[Bot escalerilla] Resultado 6/3 6/4'},100,{}),false);
 assert.equal(recoverableMessage({...message,body:'hola'},100,{}),false);
});
