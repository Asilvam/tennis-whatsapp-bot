import WhatsApp from 'whatsapp-web.js';
import qr from 'qrcode-terminal';
import {mkdir, readFile, writeFile, rename} from 'node:fs/promises';
import {normalize, parse, resultKey} from './parser.mjs';
import {findReservation, reservationNotice} from './reservation.mjs';

const {Client, LocalAuth} = WhatsApp;
const base = process.env.API_BASE_URL?.replace(/\/$/, '');
if (!base) throw new Error('Falta API_BASE_URL');
const dry = process.env.DRY_RUN !== 'false';
let groupId = process.env.WHATSAPP_GROUP_ID;
const groupName = process.env.WHATSAPP_GROUP_NAME;
const messageDate = message => new Intl.DateTimeFormat('en-CA', {timeZone:'America/Santiago', year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(message.timestamp * 1000));
await mkdir('state', {recursive:true});
let journal;
try { journal = JSON.parse(await readFile('state/messages.json', 'utf8')); }
catch (e) { if (e.code !== 'ENOENT') throw e; journal = {}; }
async function save() {
  await writeFile('state/messages.tmp', JSON.stringify(journal, null, 2), {mode:0o600});
  await rename('state/messages.tmp', 'state/messages.json');
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
const client = new Client({
  authStrategy:new LocalAuth({clientId:'tennis-results'}),
  puppeteer: {
    headless: process.env.WHATSAPP_HEADLESS !== 'false',
    ...(process.env.CHROME_PATH ? {executablePath:process.env.CHROME_PATH} : {}),
  },
});
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
          const parsed = parse(message.body, roster);
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
async function processMessage(message) {
  const chatId = message.fromMe ? message.to : message.from;
  if (!groupId || chatId !== groupId || message.type !== 'chat') return;
  if (message.body.startsWith('[Bot escalerilla]')) return;
  const id = message.id._serialized;
  if (journal[id]) return;
  let posting = false;
  try {
    if (!/\d+\s*[-:/]\s*\d+/.test(message.body)) return;
    if (!/\s+a\s+/.test(message.body)) return;
    const date = messageDate(message);
    let parsed, parseError;
    try { parsed = parse(message.body, await api('/register')); }
    catch (error) { parseError = error; }
    const key = parsed ? resultKey(parsed,groupId,date) : undefined;
    if (key && Object.values(journal).some(entry => entry.resultKey === key)) {
      journal[id] = {status:'duplicate',resultKey:key};
      await save();
      console.log('Resultado repetido ignorado:', id);
      return;
    }
    journal[id] = {status:'received',receipt:'sending',resultKey:key};
    await save();
    try {
      await message.reply('[Bot escalerilla] 📩 Resultado recibido. Validando…');
      journal[id].receipt = 'sent';
    } catch (error) {
      journal[id].receipt = 'uncertain';
      console.error('No se pudo confirmar el envío del recibido:', error.message);
    }
    await save();
    if (parseError) throw parseError;
    if (!parsed) return;
    const reserve = await findReservation(parsed, date, api);
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
