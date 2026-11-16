import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {MongoSessionStore,MongoState,acquireLease} from './mongo-store.mjs';

const matches=(doc,query)=>Object.entries(query).every(([key,value])=>value && value.$ne!==undefined ? doc[key]!==value.$ne : doc[key]===value);
function collection() {
  const docs=[];
  return {
    docs,
    async findOne(q){return docs.find(d=>matches(d,q));},
    async insertOne(doc){docs.push(doc);},
    async replaceOne(q,doc){const i=docs.findIndex(d=>matches(d,q));if(i<0)docs.push({...q,...doc});else docs[i]={...q,...doc};},
    async updateOne(q,update){const d=docs.find(d=>matches(d,q));if(d)Object.assign(d,update.$set || {});else docs.push({...q,...update.$setOnInsert,...update.$set});},
    async deleteMany(q){for(let i=docs.length-1;i>=0;i--)if(matches(docs[i],q))docs.splice(i,1);},
    find(q){const values=docs.filter(d=>matches(d,q));return {toArray:async()=>values,sort:()=>({async *[Symbol.asyncIterator](){yield* values.sort((a,b)=>a.chunk-b.chunk);}})};},
  };
}

test('guarda y recupera sesiones por fragmentos y detecta datos incompletos', async()=>{
  const dir=await mkdtemp(join(tmpdir(),'tennis-session-test-'));
  try {
    const c=collection(),store=new MongoSessionStore(c,dir),session='test';
    const data=Buffer.alloc(2*1024*1024+37,123);
    await writeFile(join(dir,'test.zip'),data);
    assert.equal(await store.sessionExists({session}),false);
    await store.save({session});
    assert.equal(c.docs.filter(d=>d.type==='chunk').length,3);
    assert.equal(await store.sessionExists({session}),true);
    await store.extract({session,path:join(dir,'restored.zip')});
    assert.deepEqual(await readFile(join(dir,'restored.zip')),data);
    await store.save({session});
    assert.equal(c.docs.filter(d=>d.type==='chunk').length,3);
    c.docs.find(d=>d.type==='chunk').data=Buffer.from('corrupto');
    await assert.rejects(store.extract({session,path:join(dir,'broken.zip')}),/dañada/);
    await store.delete({session});
    assert.equal(c.docs.length,0);
  } finally {await rm(dir,{recursive:true,force:true});}
});

test('migra sin sobrescribir estados remotos y recupera alias tras reiniciar',async()=>{
  const storage={results:collection(),aliases:collection()};
  await storage.results.insertOne({_id:'message',status:'sent'});
  const state=new MongoState(storage);
  const loaded=await state.load({message:{status:'pending'},new:{status:'needs_confirmation'}},{group:{maxi:'player'}});
  assert.equal(loaded.journal.message.status,'sent');
  loaded.journal.new.status='alias_confirmed';await state.save(loaded.journal);
  loaded.aliases.group.otro='other';await state.saveAliases(loaded.aliases);
  const recovered=await new MongoState(storage).load();
  assert.equal(recovered.journal.new.status,'alias_confirmed');
  assert.deepEqual(recovered.aliases,{group:{maxi:'player',otro:'other'}});
});

test('no permite otra instancia cuando el bloqueo ya está tomado',async()=>{
  assert.equal(await acquireLease({findOneAndUpdate:async()=>{const e=new Error();e.code=11000;throw e;}},'new'),false);
  assert.equal(await acquireLease({findOneAndUpdate:async()=>({owner:'same'})},'same'),true);
});
