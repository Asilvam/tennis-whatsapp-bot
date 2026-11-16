import {mkdir,readFile,writeFile,rename,open} from 'node:fs/promises';
import {resolve,join,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import {connectStorage,acquireLease,leaseNotice} from './mongo-store.mjs';

export async function resetStoredHistory(results,{apply=false,directory='state',assertLease=()=>{}}={}) {
  const records=await results.find({}).toArray();
  const localPath=join(directory,'messages.json');
  let local={};
  try {local=JSON.parse(await readFile(localPath,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
  if(!apply)return {preview:true,count:records.length,localCount:Object.keys(local).length};
  assertLease();
  const backups=join(directory,'backups');await mkdir(backups,{recursive:true});
  const backup=join(backups,`history-${new Date().toISOString().replace(/[:.]/g,'-')}-${randomUUID().slice(0,8)}.json`);
  // No borrar nada si no se pudo escribir y sincronizar el respaldo.
  const file=await open(backup,'wx',0o600);
  try {await file.writeFile(JSON.stringify({createdAt:new Date().toISOString(),collection:'bot_results',records,localJournal:local},null,2));await file.sync();}finally{await file.close();}
  assertLease();
  // Evita que el arranque vuelva a importar el diario local anterior a MongoDB.
  await mkdir(dirname(localPath),{recursive:true});
  const temp=localPath+'.reset.tmp';await writeFile(temp,'{}\n',{mode:0o600});await rename(temp,localPath);
  assertLease();
  const deleted=await results.deleteMany({});
  return {preview:false,count:deleted.deletedCount,backup};
}

async function main() {
  const args=process.argv.slice(2);
  if(args.some(arg=>arg!=='--apply'))throw new Error('Uso: npm run history:reset -- [--apply]');
  let storage,heartbeat,leaseOwned=false,lost=false;
  const owner=randomUUID();
  try {
    storage=await connectStorage(process.env.MONGODB_URI,process.env.MONGODB_DATABASE||'Tennis');
    if(args.includes('--apply')) {
      leaseOwned=await acquireLease(storage.sessions,owner);
      if(!leaseOwned) {
        const lock=await storage.sessions.findOne({_id:'lock:tennis-results'});
        console.error(leaseNotice(lock?.expiresAt));
        console.error('Detén el bot con Ctrl+C antes de reiniciar el historial. No se borró nada.');
        process.exitCode=1;return;
      }
      heartbeat=setInterval(async()=>{try{if(!await acquireLease(storage.sessions,owner))lost=true;}catch{lost=true;}},10000);
    }
    const result=await resetStoredHistory(storage.results,{apply:args.includes('--apply'),assertLease:()=>{if(lost)throw new Error('Se perdió el bloqueo; reinicio de historial detenido');}});
    console.log(`Base: ${storage.connection.name}. Colección: bot_results.`);
    if(result.preview) {
      console.log(`Vista previa: ${result.count} mensajes en MongoDB y ${result.localCount} en el respaldo local. No se borró nada.`);
      console.log('Para aplicar, detén el bot y ejecuta: npm run history:reset -- --apply');
    } else {
      console.log(`Historial reiniciado: ${result.count} mensajes eliminados. Respaldo: ${resolve(result.backup)}`);
      console.log('Sesión de WhatsApp, alias, reservas y puntos conservados. Inicia el bot y envía mensajes nuevos.');
    }
  } finally {
    clearInterval(heartbeat);
    if(storage) {
      if(leaseOwned)await storage.sessions.deleteOne({_id:'lock:tennis-results',owner});
      await storage.connection.close();
    }
  }
}
if(process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error=>{console.error('No se pudo reiniciar el historial:',error.name,'código:',error.code||'sin código');process.exitCode=1;});
}
