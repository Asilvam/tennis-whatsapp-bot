import mongoose from 'mongoose';
import {randomUUID, createHash} from 'node:crypto';
import {open, mkdir} from 'node:fs/promises';
import {join, dirname} from 'node:path';

export async function connectStorage(uri, dbName='Tennis') {
  if (!uri) throw new Error('Falta MONGODB_URI');
  const connection=await mongoose.createConnection(uri,{dbName,serverSelectionTimeoutMS:10000}).asPromise();
  const db=connection.db;
  for (const name of ['bot_sessions','bot_results','bot_aliases']) {
    try {await db.createCollection(name);} catch(e) {if(e.code!==48) throw e;}
  }
  const sessions=db.collection('bot_sessions'), results=db.collection('bot_results'), aliases=db.collection('bot_aliases');
  await results.createIndex({resultKey:1});
  await aliases.createIndex({groupId:1,label:1},{unique:true});
  await sessions.createIndex({session:1,version:1,chunk:1},{partialFilterExpression:{type:'chunk'},unique:true});
  return {connection,sessions,results,aliases};
}

export class MongoState {
  constructor(storage) {this.storage=storage;this.previous=new Map();}
  async load(localJournal={},localAliases={}) {
    const {results,aliases}=this.storage;
    // Nunca sobrescribir estados remotos con un respaldo local antiguo.
    for (const [id,entry] of Object.entries(localJournal)) await results.updateOne({_id:id},{$setOnInsert:{...entry,updatedAt:new Date()}},{upsert:true});
    for (const [groupId,entries] of Object.entries(localAliases)) {
      for (const [label,email] of Object.entries(entries)) await aliases.updateOne({groupId,label},{$setOnInsert:{email,updatedAt:new Date()}},{upsert:true});
    }
    const journal={};
    for (const {_id,updatedAt,...entry} of await results.find({}).toArray()) {
      journal[_id]=entry;
      this.previous.set(_id,JSON.stringify(entry));
    }
    const aliasMap={};
    for (const {groupId,label,email} of await aliases.find({}).toArray()) (aliasMap[groupId] ||= {})[label]=email;
    return {journal,aliases:aliasMap};
  }
  async save(journal) {
    for (const [id,entry] of Object.entries(journal)) {
      const serialized=JSON.stringify(entry);
      if (serialized===this.previous.get(id)) continue;
      const clean=JSON.parse(serialized);
      await this.storage.results.replaceOne({_id:id},{...clean,updatedAt:new Date()},{upsert:true});
      this.previous.set(id,serialized);
    }
  }
  async saveAliases(aliasMap) {
    for (const [groupId,entries] of Object.entries(aliasMap)) {
      for (const [label,email] of Object.entries(entries)) await this.storage.aliases.updateOne({groupId,label},{$set:{email,updatedAt:new Date()}},{upsert:true});
    }
  }
}

// Adaptador de RemoteAuth: una sola colección incluso para sesiones >16 MB.
export class MongoSessionStore {
  constructor(collection,dataPath) {this.collection=collection;this.dataPath=dataPath;}
  async sessionExists({session}) {return !!await this.collection.findOne({_id:`session:${session}`});}
  save(options) {
    if (this.saving) return this.saving;
    this.saving = this.saveOnce(options).finally(() => { this.saving = null; });
    return this.saving;
  }
  async saveOnce({session}) {
    const version=randomUUID(), file=await open(join(this.dataPath,`${session}.zip`),'r');
    const hash=createHash('sha256');let count=0,size=0;
    try {
      while(true) {
        const buffer=Buffer.alloc(1024*1024);
        const {bytesRead}=await file.read(buffer,0,buffer.length,null);
        if(!bytesRead) break;
        const data=buffer.subarray(0,bytesRead);hash.update(data);size+=bytesRead;
        await this.collection.insertOne({type:'chunk',session,version,chunk:count++,data});
      }
    } finally {await file.close();}
    await this.collection.replaceOne({_id:`session:${session}`},{type:'manifest',session,version,count,size,sha256:hash.digest('hex'),updatedAt:new Date()},{upsert:true});
    await this.collection.deleteMany({type:'chunk',session,version:{$ne:version}});
  }
  async extract({session,path}) {
    const manifest=await this.collection.findOne({_id:`session:${session}`});
    if(!manifest) throw new Error('No hay sesión remota');
    await mkdir(dirname(path),{recursive:true});
    const file=await open(path,'w',0o600);const hash=createHash('sha256');let count=0,size=0;
    try {
      for await(const entry of this.collection.find({type:'chunk',session,version:manifest.version}).sort({chunk:1})) {
        if(entry.chunk!==count++) throw new Error('Sesión remota incompleta');
        const data=Buffer.isBuffer(entry.data)?entry.data:Buffer.from(entry.data.buffer);
        await file.writeFile(data);hash.update(data);size+=data.length;
      }
    } finally {await file.close();}
    if(count!==manifest.count || size!==manifest.size || hash.digest('hex')!==manifest.sha256) throw new Error('Sesión remota dañada; no se utilizará');
  }
  async delete({session}) {await this.collection.deleteMany({session});}
}

export async function acquireLease(collection,owner,now=new Date()) {
  try {
    const result=await collection.findOneAndUpdate({_id:'lock:tennis-results',$or:[{expiresAt:{$lt:now}},{owner}]},{$set:{type:'lock',owner,expiresAt:new Date(now.getTime()+90000)}},{upsert:true,returnDocument:'after'});
    return result?.owner===owner;
  } catch(e) {if(e.code===11000)return false;throw e;}
}

export function serializeAsync(task) {
  let pending;
  return (...args) => {
    if (pending) return pending;
    pending=Promise.resolve().then(()=>task(...args)).finally(()=>{pending=null;});
    return pending;
  };
}
