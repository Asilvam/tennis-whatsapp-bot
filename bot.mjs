import WhatsApp from 'whatsapp-web.js';
import qr from 'qrcode-terminal';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {normalize, parse, resultKey} from './parser.mjs';
import {findReservation, reservationNotice} from './reservation.mjs';
import {suggestAlias, senderOf, confirmationAnswer} from './aliases.mjs';
import {findDuplicate, duplicateNotice} from './duplicates.mjs';
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
catch(error) {console.error('No se pudo conectar MongoDB:',error.name,'código:',error.code || 'sin código');process.exit(1);}
const owner=randomUUID();
if(!await acquireLease(storage.sessions,owner)) {
  const lock=await storage.sessions.findOne({_id:'lock:tennis-results'},{projection:{expiresAt:1}});
  console.error(leaseNotice(lock?.expiresAt));
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
console.log(`Persistencia MongoDB activa: ${storage.connection.name}; ${Object.keys(journal).length} mensajes recuperados.`);
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
async function shutdown(code=0) {
  if(stopping)return;stopping=true;
  clearInterval(heartbeat);
  try {await client.destroy();} catch {}
  try {await storage.sessions.deleteOne({_id:'lock:tennis-results',owner});} catch {}
  await storage.connection.close();process.exit(code);
}
const heartbeat=setInterval(async()=>{
  try {if(!await acquireLease(storage.sessions,owner)) {console.error('Otra instancia tiene el control; deteniendo bot.');await shutdown(1);}}
  catch {console.error('Se perdió la conexión a MongoDB; deteniendo bot.');await shutdown(1);}
},30000);
process.on('SIGTERM',()=>shutdown());
process.on('SIGINT',()=>shutdown());
client.on('remote_session_saved',()=>console.log('Sesión de WhatsApp guardada en MongoDB.'));
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
    console.log('Confirmación enviada:', message.id._serialized);
  } catch (error) {
    entry.acknowledgement = 'uncertain';
    await save();
    console.error('No se pudo confirmar el envío del aviso:', error.message);
  }
}
async function resolveGroup() {
  if (groupId) return;
  const groups = (await client.getChats()).filter(chat => chat.isGroup);
  if (!groupName) {
    for (const chat of groups) console.log(chat.name, chat.id._serialized);
    return;
  }
  const matches = groups.filter(chat => normalize(chat.name) === normalize(groupName));
  if (matches.length !== 1) {
    console.log(`Grupo pendiente: ${groupName}. Coincidencias: ${matches.length}`);
    return;
  }
  groupId = matches[0].id._serialized;
  await writeFile('state/group.json', JSON.stringify({name:matches[0].name,id:groupId}), {mode:0o600});
  console.log('Grupo seleccionado:', matches[0].name, groupId);
}
client.on('ready', async () => {
  console.log(`Bot conectado. Modo prueba: ${dry}`);
  await resolveGroup();
  // Incorporar los resultados ya revisados antes de activar esta regla.
  if (groupId) {
    const missing = Object.entries(journal).filter(([,entry]) => !entry.resultKey);
    if (missing.length) {
      const roster = await api('/register');
      for (const [id, entry] of missing) {
        try {
          const message = await client.getMessageById(id);
          if (!message || (message.fromMe ? message.to : message.from) !== groupId) continue;
          const parsed = parse(message.body, roster, aliases[groupId] || {});
          const date = Number.isFinite(message.timestamp) ? messageDate(message) : entry.reason?.match(/\d{4}-\d{2}-\d{2}/)?.[0];
          if (parsed && date) entry.resultKey = resultKey(parsed, groupId, date);
        } catch (error) { console.error('No se pudo indexar un resultado anterior:', error.message); }
      }
      await save();
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
      console.log('Revisando mensaje reciente:', message.body);
      await processMessage(message);
    }
  }
});
setInterval(() => { if (!groupId) resolveGroup().catch(console.error); }, 20000);
let queue = Promise.resolve();
async function processMessage(message, resume = false) {
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
      const roster=await api('/register');
      if (!roster.some(p=>p.email===pending.suggestion.email)) {
        await message.reply('[Bot escalerilla] El jugador ya no aparece en el padrón. El resultado sigue pendiente de revisión.');
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
    try { roster=await api('/register'); parsed = parse(message.body, roster, aliases[groupId] || {}); }
    catch (error) { parseError = error; }
    const key = parsed ? resultKey(parsed,groupId,date) : undefined;
    const duplicate=key && findDuplicate(journal,key,id);
    if (duplicate) {
      journal[id] = {...journal[id],status:'duplicate',resultKey:key,duplicateOf:duplicate.id};
      await save();
      journal[id].acknowledgement='sending';await save();
      await message.reply(duplicateNotice(duplicate.entry,resume));
      journal[id].acknowledgement='sent';await save();
      console.log('Resultado repetido: aviso enviado sin reingresar ni modificar puntos:', id);
      return;
    }
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
      console.error('No se pudo confirmar el envío del recibido:', error.message);
    }
    await save();
    }
    const suggestion=parseError && suggestAlias(parseError.teamText,roster || [],aliases[groupId] || {});
    if (suggestion) {
      journal[id]={...journal[id],status:'needs_confirmation',groupId,sender:senderOf(message),suggestion,originalBody:message.body,originalTimestamp:message.timestamp,expiresAt:Date.now()+24*60*60*1000};
      await save();
      const question=await message.reply(`[Bot escalerilla] ¿Con “${suggestion.label}” te refieres a “${suggestion.name}”? Quien envió el resultado debe responder “sí” o “no” citando esta pregunta. El resultado queda pendiente; aún no se ha ingresado.`);
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
      console.log('PREVISTA', JSON.stringify(payload));
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
    console.log('Registrado', payload.matchId);
    await acknowledge(message);
  } catch (error) {
    journal[id] = {...journal[id],status:posting ? 'uncertain' : 'pending',reason:error.message,reasonCode:error.code};
    await save();
    console.error('Revisión manual:', id, error.message);
    await acknowledge(message);
  }
}
client.on('message', message => { queue = queue.then(() => processMessage(message)).catch(console.error); });
client.on('message_create', message => {
  if (message.fromMe) queue = queue.then(() => processMessage(message)).catch(console.error);
});
client.on('auth_failure', () => console.error('Falló la vinculación de WhatsApp'));
client.on('disconnected', reason => console.error('WhatsApp desconectado:', reason));
await client.initialize();
