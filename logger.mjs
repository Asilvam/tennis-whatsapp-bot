import {createHash} from 'node:crypto';

const levels={DEBUG:0,INFO:1,AVISO:2,ERROR:3};
const redact=value=>String(value).replace(/mongodb(?:\+srv)?:\/\/[^\s]+/gi,'[conexión MongoDB oculta]').replace(/Bearer\s+\S+/gi,'Bearer [oculto]').replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,'[correo oculto]').replace(/\s+/g,' ').trim();
export const messageRef=id=>createHash('sha256').update(String(id)).digest('hex').slice(0,8);
export function formatLog(level,event,detail,{messageId,players,score,reservation}={},now=new Date()) {
  const time=new Intl.DateTimeFormat('es-CL',{timeZone:'America/Santiago',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).format(now);
  const parts=[`[${time}] [${level}] [${event}]`,messageId?`[msg:${messageRef(messageId)}]`:null,redact(detail),players?`| Jugadores: ${redact(players)}`:null,score?`| Marcador: ${redact(score)}`:null,reservation?`| Reserva: ${redact(reservation)}`:null];
  return parts.filter(Boolean).join(' ');
}
export function logEvent(level,event,detail,context={}) {
  const threshold=process.env.LOG_LEVEL?.toLowerCase()==='debug'?0:1;
  if((levels[level]??1)<threshold)return;
  const line=formatLog(level,event,detail,context);
  if(level==='ERROR')console.error(line);else console.log(line);
}
