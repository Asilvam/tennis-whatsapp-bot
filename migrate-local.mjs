import WhatsApp from 'whatsapp-web.js';
import {readFile,rm,access} from 'node:fs/promises';
import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {connectStorage,MongoState,MongoSessionStore,acquireLease} from './mongo-store.mjs';

let storage;
const owner=randomUUID();
try {
  storage=await connectStorage(process.env.MONGODB_URI,process.env.MONGODB_DATABASE || 'Tennis');
  if(!await acquireLease(storage.sessions,owner)) throw new Error('Otra instancia remota está activa');
  const local=async file=>{try{return JSON.parse(await readFile(file,'utf8'));}catch(e){if(e.code==='ENOENT')return {};throw e;}};
  const state=new MongoState(storage);
  const loaded=await state.load(await local('state/messages.json'),await local('state/aliases.json'));
  console.log('Mensajes persistidos:',Object.keys(loaded.journal).length);
  const dataPath=resolve('.wwebjs_auth'),session='RemoteAuth-tennis-results';
  const store=new MongoSessionStore(storage.sessions,dataPath);
  if(!await store.sessionExists({session})) {
    const legacy=resolve('.wwebjs_auth/session-tennis-results');
    await access(legacy);
    const auth=new WhatsApp.RemoteAuth({clientId:'tennis-results',store,backupSyncIntervalMs:60000,dataPath});
    auth.userDataDir=legacy;auth.sessionName=session;
    let zip;
    try {
      zip=await auth.compressSession();
      await store.save({session});
      console.log('Sesión local copiada a MongoDB; la sesión original se conserva.');
    } finally {
      if(zip) await rm(zip,{force:true});
      await rm(auth.tempDir,{recursive:true,force:true});
    }
  } else console.log('Sesión remota existente conservada.');
} catch(e) {
  console.error('Migración detenida:',e.name,'código:',e.code || 'sin código');process.exitCode=1;
} finally {
  if(storage) {await storage.sessions.deleteOne({_id:'lock:tennis-results',owner});await storage.connection.close();}
}
