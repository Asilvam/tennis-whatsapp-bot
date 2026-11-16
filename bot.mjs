import WhatsApp from 'whatsapp-web.js';
import qr from 'qrcode-terminal';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {normalize, parse, resultKey, activePlayers} from './parser.mjs';
import {findReservation, reservationNotice} from './reservation.mjs';
import {suggestAlias, senderOf, confirmationAnswer} from './aliases.mjs';
import {findDuplicate, duplicateNotice} from './duplicates.mjs';
import {recoverableMessage} from './message-recovery.mjs';
import {logEvent} from './logger.mjs';
const logError=error=>logEvent('ERROR','PROCESAMIENTO',error.message || String(error));
import {connectStorage, MongoState, MongoSessionStore, acquireLease, serializeAsync, leaseNotice} from './mongo-store.mjs';

const {Client, RemoteAuth} = WhatsApp;
const base = process.env.API_BASE_URL?.replace(/\/$/, '');
if (!base) throw new Error('Falta API_BASE_URL');
const dry = process.env.DRY_RUN !== 'false';
const startedAt = Math.floor(Date.now()/1000);
let groupId = process.env.WHATSAPP_GROUP_ID;
const groupName = process.env.WHATSAPP_GROUP_NAME;
const messageDate = message => new Intl.DateTimeFormat('en-CA', {timeZone:'America/Santiago', year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(message.timestamp * 1000));
await mkdir('state', {recursive:true});
let storage;
try {storage=await connectStorage(process.env.MONGODB_URI,process.env.MONGODB_DATABASE || 'Tennis');}
catch(error) {logEvent('ERROR','MONGODB',`No se pudo conectar: ${error.name}; código ${error.code || 'sin código'}`);process.exit(1);}
const owner=randomUUID();
if(!await acquireLease(storage.sessions,owner)) {
  const lock=await storage.sessions.findOne({_id:'lock:tennis-results'},{projection:{expiresAt:1}});
  logEvent('AVISO','INICIO_BLOQUEADO',leaseNotice(lock?.expiresAt));
  await storage.connection.close();
  process.exit(1);
}
const state=new MongoState(storage);
let journal;
try { journal = JSON.parse(await readFile('state/messages.json', 'utf8')); }
catch (e) { if (e.code !== 'ENOENT') throw e; journal = {}; }
let aliases;
try { aliases = JSON.parse(await readFile('state/aliases.json','utf8')); }
catch (e) { if (e.code !== 'ENOENT') throw e; aliases = {}; }
({journal,aliases}=await state.load(journal,aliases));
logEvent('INFO','MONGODB',`Conectado a ${storage.connection.name}; ${Object.keys(journal).length} mensajes recuperados.`);
async function saveAliases() {
  await state.saveAliases(aliases);
}
async function save() {
  await state.save(journal);
}
async function api(path, body) {
  const response = await fetch(base + path, {
    method: body ? 'POST' : 'GET', signal: AbortSignal.timeout(30000),
    headers: {'Content-Type':'application/json', ...(process.env.API_TOKEN ? {Authorization:`Bearer ${process.env.API_TOKEN}`} : {})},
    ...(body ? {body:JSON.stringify(body)} : {}),
  });
  if (!response.ok) throw new Error(`API ${path}: HTTP ${response.status}`);
  return response.json();
}
const auth=new RemoteAuth({clientId:'tennis-results',store:new MongoSessionStore(storage.sessions,resolve('.wwebjs_auth')),backupSyncIntervalMs:60000});
// Serializar compresión y subida completas: el intervalo puede vencer antes del respaldo.
auth.storeRemoteSession=serializeAsync(auth.storeRemoteSession.bind(auth));
const client = new Client({
  authStrategy:auth,
  puppeteer: {
    headless: process.env.WHATSAPP_HEADLESS !== 'false',
    ...(process.env.CHROME_PATH ? {executablePath:process.env.CHROME_PATH} : {}),
  },
});
let stopping=false;
let botReady=false;
let recovering=false;
async function shutdown(code=0) {
  if(stopping)return;stopping=true;
  logEvent('INFO','CIERRE','Deteniendo el bot y cerrando WhatsApp.');
  clearInterval(heartbeat);
  const forceExit=setTimeout(()=>{
    logEvent('AVISO','CIERRE_FORZADO','El cierre superó 8 segundos. El bloqueo vencerá automáticamente.');
    try {client.pupBrowser?.process()?.kill('SIGKILL');} catch {}
    process.exit(code);
  },8000);
  try {await client.destroy();} catch {}
  try {await storage.sessions.deleteOne({_id:'lock:tennis-results',owner});} catch {}
  await storage.connection.close();clearTimeout(forceExit);process.exit(code);
}
const heartbeat=setInterval(async()=>{
  try {if(!await acquireLease(storage.sessions,owner)) {logEvent('ERROR','BLOQUEO_PERDIDO','Otra instancia tiene el control; deteniendo bot.');await shutdown(1);}}
  catch {logEvent('ERROR','MONGODB','Se perdió la conexión; deteniendo bot.');await shutdown(1);}
},10000);
process.on('SIGTERM',()=>shutdown());
process.on('SIGINT',()=>shutdown());
client.on('remote_session_saved',()=>logEvent('DEBUG','RESPALDO','Sesión de WhatsApp guardada en MongoDB.'));
client.on('qr', value => qr.generate(value, {small:true}));
async function acknowledge(message) {
  const entry = journal[message.id._serialized];
  if (!entry || entry.acknowledgement) return;
  let text;
  if (entry.status === 'sent') text = '✅ Resultado ya ingresado.';
  else if (entry.status === 'preview') text = '🧪 Resultado validado con su reserva. Estamos en modo prueba: no se registró ni se modificaron puntos.';
  else if (entry.status === 'uncertain') text = '⚠️ No pude confirmar el registro. Se requiere revisión antes de reintentar para evitar duplicados.';
  else if (reservationNotice(entry.reasonCode)) text = reservationNotice(entry.reasonCode);
  else if (entry.reason?.includes('encontradas 0')) text = '⚠️ No hay un partido de ranking agendado y pendiente de resultado para esos jugadores en la fecha del mensaje. El resultado no fue ingresado.';
  else text = '⚠️ Resultado recibido, pero pendiente de revisión: no pude validar los jugadores, el marcador o una reserva única. No se confirmó el registro.';
  // Guardar antes del envío: ante una respuesta incierta, evitar avisos duplicados.
  entry.acknowledgement = 'sending';
  await save();
  try {
    await message.reply(`[Bot escalerilla] ${text}`);
    entry.acknowledgement = 'sent';
    await save();
    logEvent('INFO','AVISO_ENVIADO',`Respuesta de WhatsApp enviada; estado: ${entry.status}.`,{messageId:message.id._serialized});
  } catch (error) {
    entry.acknowledgement = 'uncertain';
    await save();
    logEvent('ERROR','AVISO_NO_CONFIRMADO',error.message,{messageId:message.id._serialized});
  }
}
async function resolveGroup() {
  if (groupId) return;
  const groups = (await client.getChats()).filter(chat => chat.isGroup);
  if (!groupName) {
    for (const chat of groups) logEvent('INFO','GRUPO_DISPONIBLE',`${chat.name}: ${chat.id._serialized}`);
    return;
  }
  const matches = groups.filter(chat => normalize(chat.name) === normalize(groupName));
  if (matches.length !== 1) {
    logEvent('AVISO','GRUPO_PENDIENTE',`${groupName}; coincidencias: ${matches.length}`);
    return;
  }
  groupId = matches[0].id._serialized;
  await writeFile('state/group.json', JSON.stringify({name:matches[0].name,id:groupId}), {mode:0o600});
  logEvent('INFO','GRUPO',`Seleccionado: ${matches[0].name}`);
}
client.on('ready', async () => {
  logEvent('INFO','WHATSAPP',`Conectado. Modo: ${dry ? 'SIMULACIÓN, no modifica puntos' : 'REGISTRO REAL, modifica puntos'}.`);
  await resolveGroup();
  // Incorporar los resultados ya revisados antes de activar esta regla.
  if (groupId) {
    const missing = Object.entries(journal).filter(([,entry]) => !entry.resultKey);
    if (missing.length) {
      const roster = activePlayers(await api('/register'));
      let indexed=0,skipped=0;
      for (const [id, entry] of missing) {
        try {
          const message = await client.getMessageById(id);
          if (!message || (message.fromMe ? message.to : message.from) !== groupId) continue;
          const parsed = parse(message.body, roster, aliases[groupId] || {});
          const date = Number.isFinite(message.timestamp) ? messageDate(message) : entry.reason?.match(/\d{4}-\d{2}-\d{2}/)?.[0];
          if (parsed && date) {entry.resultKey = resultKey(parsed, groupId, date);indexed++;}
        } catch (error) {skipped++;logEvent('DEBUG','HISTORIAL_OMITIDO',error.message,{messageId:id});}
      }
      await save();
      logEvent('INFO','HISTORIAL',`${indexed} mensajes anteriores indexados; ${skipped} omitidos por nombres o formato. No son resultados nuevos. Detalles: LOG_LEVEL=debug.`);
    }
  }
  if (groupId && process.env.ACK_MESSAGE_ID) {
    const message = await client.getMessageById(process.env.ACK_MESSAGE_ID);
    if (message && (message.fromMe ? message.to : message.from) === groupId) await acknowledge(message);
  }
  if (dry && groupId && process.env.CHECK_RECENT === 'true') {
    const chat = await client.getChatById(groupId);
    for (const message of await chat.fetchMessages({limit:3})) {
      if (message.timestamp < Date.now()/1000 - 1800) continue;
      logEvent('DEBUG','REVISION_RECIENTE','Revisando mensaje de prueba.',{messageId:message.id._serialized});
      await processMessage(message);
    }
  }
});
client.on('ready',()=>{botReady=true;recoverRecentMessages().catch(logError);});
client.on('disconnected',()=>{botReady=false;});
async function recoverRecentMessages() {
  if(!botReady || !groupId || stopping || recovering)return;
  recovering=true;
  try {
    const chat=await client.getChatById(groupId);
    const recent=await chat.fetchMessages({limit:30});
    for(const message of recent) {
      if(!recoverableMessage(message,startedAt,journal))continue;
      logEvent('INFO','MENSAJE_RECUPERADO','Mensaje reciente pendiente; encolado para revisión.',{messageId:message.id._serialized});
      queue=queue.then(()=>processMessage(message)).catch(logError);
    }
    await queue;
  } finally {recovering=false;}
}
setInterval(()=>recoverRecentMessages().catch(error=>logEvent('ERROR','RECUPERACION',error.message)),15000);
setInterval(() => { if (!groupId) resolveGroup().catch(logError); }, 20000);
let queue = Promise.resolve();
async function processMessage(message, resume = false) {
  if(stopping)return;
  const chatId = message.fromMe ? message.to : message.from;
  if (!groupId || chatId !== groupId || message.type !== 'chat') return;
  if (message.body.startsWith('[Bot escalerilla]')) return;
  if (!dry && !resume && message.timestamp < startedAt) return;
  if (!resume && message.hasQuotedMsg && ['si','no'].includes(normalize(message.body))) {
    const quoted = await message.getQuotedMessage();
    for (const [originalId,pending] of Object.entries(journal)) {
      if (pending.groupId !== groupId) continue;
      const answer=confirmationAnswer(message,pending,quoted.id._serialized);
      if (answer===null) continue;
      if (!answer) {
        pending.status='alias_rejected';
        await save();
        await message.reply('[Bot escalerilla] No usaré ese nombre. Reenvía el resultado con el nombre completo correcto.');
        return;
      }
      const roster=activePlayers(await api('/register'));
      if (!roster.some(p=>p.email===pending.suggestion.email)) {
        await message.reply('[Bot escalerilla] El jugador ya no está activo en el padrón. El resultado sigue pendiente de revisión.');
        return;
      }
      aliases[groupId] ||= {};
      aliases[groupId][normalize(pending.suggestion.label)] = pending.suggestion.email;
      await saveAliases();
      pending.status='alias_confirmed';
      await save();
      const original=await client.getMessageById(originalId);
      if (!original) return;
      original.body=pending.originalBody;
      original.timestamp=pending.originalTimestamp;
      await processMessage(original,true);
      return;
    }
    return;
  }
  const id = message.id._serialized;
  if (journal[id] && !resume) return;
  let posting = false;
  try {
    if (!/\d+\s*[-:/]\s*\d+/.test(message.body)) return;
    if (!/\s+a\s+/.test(message.body)) return;
    const date = messageDate(message);
    let parsed, parseError, roster;
    try { roster=activePlayers(await api('/register')); parsed = parse(message.body, roster, aliases[groupId] || {}); }
    catch (error) { parseError = error; }
    const key = parsed ? resultKey(parsed,groupId,date) : undefined;
    const duplicate=key && findDuplicate(journal,key,id);
    if (duplicate) {
      journal[id] = {...journal[id],status:'duplicate',resultKey:key,duplicateOf:duplicate.id};
      await save();
      journal[id].acknowledgement='sending';await save();
      await message.reply(duplicateNotice(duplicate.entry,resume));
      journal[id].acknowledgement='sent';await save();
      logEvent('INFO','DUPLICADO','Aviso enviado. No se reingresó ni se modificaron puntos.',{messageId:id});
      return;
    }
    logEvent('INFO','RESULTADO_RECIBIDO','Validando jugadores, marcador y reserva.',{messageId:id,...(parsed?{players:parsed.winner.map(p=>p.namePlayer).join(' / ')+' vs '+parsed.looser.map(p=>p.namePlayer).join(' / '),score:parsed.result}:{})});
    const receipt=journal[id]?.receipt;
    journal[id] = {
      status:'received',receipt:receipt || 'sending',resultKey:key,groupId,messageDate:date,
      ...(parsed ? {winner:parsed.winner.map(p=>p.email),looser:parsed.looser.map(p=>p.email),result:parsed.result} : {}),
    };
    await save();
    if (!receipt) {
    try {
      await message.reply('[Bot escalerilla] 📩 Resultado recibido. Validando…');
      journal[id].receipt = 'sent';
    } catch (error) {
      journal[id].receipt = 'uncertain';
      logEvent('ERROR','RECIBIDO_NO_CONFIRMADO',error.message,{messageId:id});
    }
    await save();
    }
    const suggestion=parseError && suggestAlias(parseError.teamText,roster || [],aliases[groupId] || {});
    if (suggestion) {
      journal[id]={...journal[id],status:'needs_confirmation',groupId,sender:senderOf(message),suggestion,originalBody:message.body,originalTimestamp:message.timestamp,expiresAt:Date.now()+24*60*60*1000};
      await save();
      const question=await message.reply(`[Bot escalerilla] ¿Con “${suggestion.label}” te refieres a “${suggestion.name}”? Quien envió el resultado debe responder “sí” o “no” citando esta pregunta. El resultado queda pendiente; aún no se ha ingresado.`);
      logEvent('AVISO','IDENTIDAD_PENDIENTE',`Se consultó si ${suggestion.label} corresponde a ${suggestion.name}; esperando respuesta del autor.`,{messageId:id});
      journal[id].questionId=question.id._serialized;
      await save();
      return;
    }
    if (parseError) throw parseError;
    if (!parsed) return;
    const today = messageDate({timestamp:Date.now()/1000});
    const reserve = await findReservation(parsed, today, api);
    journal[id].matchId=reserve.idCourtReserve;
    journal[id].playedDate=reserve.dateToPlay;
    if ((await api('/match-ranking')).some(r => r.matchId === reserve.idCourtReserve)) {
      const error = new Error('La reserva ya tiene un resultado');
      error.code = 'ALREADY_RECORDED';
      throw error;
    }
    async function player(p) {
      const categories = await api(`/player-category-points/${encodeURIComponent(p.email)}`);
      const active = categories.filter(c => c.isActive && (parsed.winner.length === 2 ? c.category === 'Dobles' : ['1','2','3','4'].includes(c.category)));
      if (active.length !== 1 || !p.cellular) throw new Error(`Datos/categorías incompletos: ${p.namePlayer}`);
      return {email:p.email,name:p.namePlayer,cellular:p.cellular,categories};
    }
    const payload = {matchId:reserve.idCourtReserve,result:parsed.result,winner:await Promise.all(parsed.winner.map(player)),looser:await Promise.all(parsed.looser.map(player))};
    if (dry) {
      logEvent('INFO','SIMULACION','Validación correcta; no se ingresó ni se modificaron puntos.',{messageId:id,players:payload.winner.map(p=>p.name).join(' / ')+' vs '+payload.looser.map(p=>p.name).join(' / '),score:payload.result,reservation:payload.matchId});
      journal[id] = {...journal[id],status:'preview',matchId:payload.matchId};
      await save();
      await acknowledge(message);
      return;
    }
    journal[id] = {...journal[id],status:'sending',matchId:payload.matchId};
    await save();
    posting = true;
    await api('/match-ranking', payload);
    journal[id].status = 'sent';
    await save();
    logEvent('INFO','RESULTADO_INGRESADO','Backend confirmó el registro y la actualización de puntos.',{messageId:id,score:payload.result,reservation:payload.matchId});
    await acknowledge(message);
  } catch (error) {
    journal[id] = {...journal[id],status:posting ? 'uncertain' : 'pending',reason:error.message,reasonCode:error.code};
    await save();
    logEvent(posting?'ERROR':'AVISO',posting?'REGISTRO_INCIERTO':reservationNotice(error.code)?'RESULTADO_RECHAZADO':'REQUIERE_REVISION',error.message,{messageId:id,reservation:journal[id].matchId});
    await acknowledge(message);
  }
}
client.on('message', message => { queue = queue.then(() => processMessage(message)).catch(logError); });
client.on('message_create', message => {
  if (message.fromMe) queue = queue.then(() => processMessage(message)).catch(logError);
});
client.on('auth_failure', () => logEvent('ERROR','AUTENTICACION','Falló la vinculación de WhatsApp.'));
client.on('disconnected', reason => logEvent('AVISO','WHATSAPP_DESCONECTADO',reason));
await client.initialize();
