import {normalize, resolveTeam, activePlayers} from './parser.mjs';

// Distancia de edición: solo se usa para proponer, nunca para asignar identidades.
function editDistance(a,b) {
  let previous=Array.from({length:b.length+1},(_,i)=>i);
  for(let i=1;i<=a.length;i++) {
    const row=[i];
    for(let j=1;j<=b.length;j++) row[j]=Math.min(row[j-1]+1,previous[j]+1,previous[j-1]+(a[i-1]===b[j-1]?0:1));
    previous=row;
  }
  return previous[b.length];
}
function similarSurname(query,value) {
  if(query===value)return true;
  if(Math.min(query.length,value.length)<4)return false;
  return editDistance(query,value)<=(Math.min(query.length,value.length)>=7?2:1);
}

export function suggestAlias(text, roster, aliases = {}) {
  if (!text) return null;
  roster=activePlayers(roster);
  const suggestions = [];
  function candidate(label) {
    try { resolveTeam(label,roster,aliases); return; } catch { /* Nombre aún sin identificar. */ }
    const query = normalize(label).split(' ');
    if (query.length < 2 || (query[0].length !== 1 && query[0].length < 3)) return;
    const found = roster.filter(p => {
      const tokens = normalize(p.namePlayer).split(' ');
      return tokens[0].startsWith(query[0]) && query.slice(1).every(t => tokens.slice(1).some(surname=>similarSurname(t,surname)));
    });
    if (found.length === 1) suggestions.push({label:label.trim(),email:found[0].email,name:found[0].namePlayer});
  }
  candidate(text);
  const words = text.trim().split(/\s+/);
  for (let i=2;i<=words.length-2;i++) {
    const left=words.slice(0,i).join(' '), right=words.slice(i).join(' ');
    try { if (resolveTeam(left,roster,aliases).length===1) candidate(right); } catch {}
    try { if (resolveTeam(right,roster,aliases).length===1) candidate(left); } catch {}
  }
  const unique=[...new Map(suggestions.map(s=>[normalize(s.label)+'|'+s.email,s])).values()];
  return unique.length===1 ? unique[0] : null;
}

export const senderOf = message => message.fromMe ? 'self' : message.author || message.from;
export function confirmationAnswer(message, pending, quotedId, now=Date.now()) {
  if (pending.status!=='needs_confirmation' || pending.questionId!==quotedId || pending.sender!==senderOf(message) || pending.expiresAt<now) return null;
  const answer=normalize(message.body);
  return answer==='si' ? true : answer==='no' ? false : null;
}
