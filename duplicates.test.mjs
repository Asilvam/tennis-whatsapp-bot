import {test} from 'node:test';
import assert from 'node:assert/strict';
import {findDuplicate,confirmedDuplicateNotice} from './duplicates.mjs';

test('elige el resultado revisado y no otro reenvío ni el mensaje actual',()=>{
 const prior={status:'pending',resultKey:'same',reasonCode:'TOO_OLD'};
 const journal={copy:{status:'duplicate',resultKey:'same'},prior,current:{status:'alias_confirmed',resultKey:'same'}};
 assert.deepEqual(findDuplicate(journal,'same','current'),{id:'prior',entry:prior});
 assert.equal(findDuplicate(journal,'different','current'),null);
});

test('tras confirmar un nombre informa el rechazo previo en vez de guardar silencio',()=>{
 const text=confirmedDuplicateNotice({status:'pending',reasonCode:'TOO_OLD'});
 assert.match(text,/Nombre confirmado/);assert.match(text,/más de dos días/);assert.match(text,/no fue ingresado/);
 assert.match(confirmedDuplicateNotice({status:'pending',reasonCode:'NOT_RANKING'}),/no fue creado para ranking/);
});

test('distingue registro confirmado, simulación e intento incierto',()=>{
 assert.match(confirmedDuplicateNotice({status:'sent'}),/ya fue ingresado/);
 assert.match(confirmedDuplicateNotice({status:'preview'}),/no fue ingresado ni modificó puntos/);
 assert.match(confirmedDuplicateNotice({status:'uncertain'}),/requiere revisión/);
});
