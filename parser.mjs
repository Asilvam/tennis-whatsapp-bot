export const normalize = value => value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

export function resultKey(parsed, groupId, date) {
  const team = players => players.map(p => p.email.toLowerCase()).sort();
  return JSON.stringify([groupId,date,team(parsed.winner),team(parsed.looser),parsed.result]);
}

function matches(label, player) {
  const tokens = normalize(player.namePlayer).split(' ');
  const query = normalize(label).split(' ');
  if (query.length < 2) return false;
  return query[0] === tokens[0] || (query[0].length === 1 && tokens[0].startsWith(query[0]))
    ? query.slice(1).every((t, i) => tokens.indexOf(t, i + 1) >= 0) : false;
}

function team(text, roster) {
  const words = text.trim().split(/\s+/);
  const choices = [];
  const singles = roster.filter(p => matches(text, p));
  for (const p of singles) choices.push([p]);
  for (let i = 2; i <= words.length - 2; i++) {
    for (const a of roster.filter(p => matches(words.slice(0, i).join(' '), p))) {
      for (const b of roster.filter(p => matches(words.slice(i).join(' '), p))) {
        if (a.email !== b.email) choices.push([a, b]);
      }
    }
  }
  const unique = [...new Map(choices.map(c => [c.map(p => p.email).sort().join('|'), c])).values()];
  if (unique.length !== 1) throw new Error(`Nombre ambiguo o desconocido: ${text}`);
  return unique[0];
}

export function parse(text, roster) {
  const first = /\d+\s*[-:/]\s*\d+/.exec(text);
  if (!first) return null;
  const sides = text.slice(0, first.index).trim().split(/\s+a\s+/);
  if (sides.length !== 2) throw new Error('Se espera ganadores a perdedores marcador');
  const tail = text.slice(first.index);
  const sequence = /^(\d+\s*[-:/]\s*\d+)(?:(?:\s*[,/]\s*|\s+)\d+\s*[-:/]\s*\d+)*/.exec(tail)[0];
  const sets = [...sequence.matchAll(/(\d+)\s*[-:/]\s*(\d+)/g)].map(m => [Number(m[1]), Number(m[2])]);
  if (sets.length < 2 || sets.length > 3) throw new Error('Cantidad de sets inválida');
  let wins = 0, losses = 0;
  sets.forEach(([a,b], index) => {
    if (wins === 2 || losses === 2) throw new Error('Sets después de terminado el partido');
    const hi = Math.max(a,b), lo = Math.min(a,b);
    const normal = (hi === 6 && lo <= 4) || (hi === 7 && (lo === 5 || lo === 6));
    const superTie = index === 2 && wins === 1 && losses === 1 && hi >= 10 && hi - lo >= 2 && (hi === 10 || hi - lo === 2);
    if (!normal && !superTie) throw new Error('Marcador inválido');
    if (a > b) wins++; else losses++;
  });
  if (wins !== 2) throw new Error('El marcador no corresponde a los ganadores indicados');
  const winner = team(sides[0], roster), looser = team(sides[1], roster);
  if (winner.length !== looser.length || new Set([...winner,...looser].map(p => p.email)).size !== winner.length * 2) throw new Error('Equipos inválidos');
  return {winner, looser, result: sets.map(s => s.join(':')).join(', ')};
}

export function selectReserve(parsed, reserves, date) {
  const names = [...parsed.winner,...parsed.looser].map(p => normalize(p.namePlayer)).sort().join('|');
  const fail = (code, message) => { const error = new Error(message); error.code = code; throw error; };
  if (!Array.isArray(reserves)) fail('INVALID_HISTORY', 'Respuesta de historial inválida');
  const earliest = new Date(`${date}T12:00:00Z`);
  earliest.setUTCDate(earliest.getUTCDate() - 2);
  const minimumDate = earliest.toISOString().slice(0,10);
  const matching = reserves.filter(r => {
    const players = [r.player1,r.player2,r.player3,r.player4].filter(Boolean);
    // El endpoint de historial no proyecta isDouble; inferirlo por participantes.
    const isDouble = typeof r.isDouble === 'boolean' ? r.isDouble : players.length === 4;
    return isDouble === (parsed.winner.length === 2) && players.map(normalize).sort().join('|') === names;
  });
  const scheduled = matching.filter(r => r.dateToPlay >= minimumDate && r.dateToPlay <= date);
  if (!scheduled.length && matching.some(r => r.dateToPlay < minimumDate)) fail('TOO_OLD', 'El partido tiene más de dos días de antigüedad');
  if (!scheduled.length) fail('NO_RESERVATION', `No hay partido agendado para ${date}`);
  const active = scheduled.filter(r => r.state === true);
  if (!active.length) fail('INACTIVE_RESERVATION', 'El partido no tiene una reserva activa');
  const ranking = active.filter(r => r.isForRanking === true);
  if (!ranking.length) fail('NOT_RANKING', 'El partido no fue creado para ranking');
  const found = ranking.filter(r => r.resultMatchUpdated === false);
  if (!found.length) fail('ALREADY_RECORDED', 'El partido ya tiene un resultado registrado');
  if (found.length !== 1) fail('AMBIGUOUS_RESERVATION', `Hay varias reservas pendientes para ${date}`);
  return found[0];
}
