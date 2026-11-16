import {reservationNotice} from './reservation.mjs';

export function findDuplicate(journal,key,currentId) {
  const matches=Object.entries(journal).filter(([id,entry])=>id!==currentId && entry.resultKey===key);
  const match=matches.find(([,entry])=>entry.status!=='duplicate') || matches[0];
  return match ? {id:match[0],entry:match[1]} : null;
}

export function duplicateNotice(entry, confirmedName=false) {
  let status;
  if(entry.status==='sent') status='✅ Este resultado ya fue ingresado. No se volverán a modificar los puntos.';
  else if(entry.status==='preview') status='🧪 Este resultado ya se revisó en modo prueba; no fue ingresado ni modificó puntos. Requiere revisión manual para habilitar su registro.';
  else if(entry.status==='uncertain'||entry.status==='sending') status='⚠️ Este resultado ya tiene un intento de registro que requiere revisión. No se volverá a enviar para evitar duplicar puntos.';
  else status=reservationNotice(entry.reasonCode)||'⚠️ Este resultado ya fue revisado y quedó pendiente. Requiere revisión manual; no se ha confirmado su registro.';
  return `[Bot escalerilla] ${confirmedName ? 'Nombre confirmado.' : 'Resultado repetido: ya fue revisado.'} ${status}`;
}

export const confirmedDuplicateNotice = entry => duplicateNotice(entry,true);
