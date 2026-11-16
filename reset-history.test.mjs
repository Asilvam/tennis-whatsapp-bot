import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';import {tmpdir} from 'node:os';
import {resetStoredHistory} from './reset-history.mjs';

test('vista previa no borra nada ni cambia el diario local',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'tennis-reset-'));
 try{
 const local={old:{status:'pending'}};await writeFile(join(directory,'messages.json'),JSON.stringify(local));
 const results={find:()=>({toArray:async()=>[{_id:'old',status:'sent'}]}),deleteMany:()=>assert.fail('No debe borrar')};
 const result=await resetStoredHistory(results,{directory});assert.equal(result.preview,true);assert.equal(result.count,1);
 assert.deepEqual(JSON.parse(await readFile(join(directory,'messages.json'),'utf8')),local);
 }finally{await rm(directory,{recursive:true,force:true});}
});

test('respalda antes de borrar y vacía el diario para no reimportar registros',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'tennis-reset-'));
 try{
 const records=[{_id:'old',status:'pending',reasonCode:'NOT_RANKING'}];let deleted=false;
 await writeFile(join(directory,'messages.json'),JSON.stringify({old:{status:'pending'}}));
 const results={find:()=>({toArray:async()=>records}),deleteMany:async query=>{assert.deepEqual(query,{});deleted=true;return {deletedCount:records.length};}};
 const result=await resetStoredHistory(results,{apply:true,directory});assert.equal(deleted,true);
 const backup=JSON.parse(await readFile(result.backup,'utf8'));assert.deepEqual(backup.records,records);assert.equal(backup.localJournal.old.status,'pending');
 assert.deepEqual(JSON.parse(await readFile(join(directory,'messages.json'),'utf8')),{});
 }finally{await rm(directory,{recursive:true,force:true});}
});

test('no borra el historial si se perdió el bloqueo',async()=>{
 const results={find:()=>({toArray:async()=>[]}),deleteMany:()=>assert.fail('No debe borrar')};
 await assert.rejects(resetStoredHistory(results,{apply:true,assertLease:()=>{throw new Error('Sin bloqueo');}}),/Sin bloqueo/);
});
