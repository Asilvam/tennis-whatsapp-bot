import {test} from 'node:test';
import assert from 'node:assert/strict';
import {selectReserve} from './parser.mjs';
import {findReservation, reservationNotice} from './reservation.mjs';

const parsed = {winner:[{namePlayer:'Jugador Uno'}],looser:[{namePlayer:'Jugador Dos'}]};
const date = '2026-11-15';
const reserve = {idCourtReserve:'test',dateToPlay:date,player1:'Jugador Uno',player2:'Jugador Dos',state:true,isForRanking:true,resultMatchUpdated:false,turn:'09:00-10:00'};

test('consulta el historial y acepta una reserva cuyo horario ya terminó', async () => {
  const api = async path => {
    assert.equal(path,'/court-reserve/history/Jugador%20Uno');
    return [reserve];
  };
  assert.equal(await findReservation(parsed,date,api),reserve);
});

test('distingue inexistente, inactiva, no ranking, ingresada y ambigua', () => {
  for (const [records,code] of [
    [[], 'NO_RESERVATION'],
    [[{...reserve,dateToPlay:'2026-11-16'}], 'NO_RESERVATION'],
    [[{...reserve,dateToPlay:'2026-11-12'}], 'TOO_OLD'],
    [[{...reserve,player2:'Otro Jugador'}], 'NO_RESERVATION'],
    [[{...reserve,state:false}], 'INACTIVE_RESERVATION'],
    [[{...reserve,isForRanking:false}], 'NOT_RANKING'],
    [[{...reserve,resultMatchUpdated:true}], 'ALREADY_RECORDED'],
    [[reserve,{...reserve,idCourtReserve:'otro'}], 'AMBIGUOUS_RESERVATION'],
  ]) {
    assert.throws(()=>selectReserve(parsed,records,date),error=>error.code===code);
    assert.ok(reservationNotice(code));
  }
  assert.match(reservationNotice('NOT_RANKING'),/está agendado, pero no fue creado para ranking/);
});

test('infiere dobles cuando el historial no incluye isDouble', () => {
  const doubles={winner:[{namePlayer:'Jugador Uno'},{namePlayer:'Jugador Tres'}],looser:[{namePlayer:'Jugador Dos'},{namePlayer:'Jugador Cuatro'}]};
  const booking={...reserve,player3:'Jugador Tres',player4:'Jugador Cuatro'};
  assert.equal(selectReserve(doubles,[booking],date),booking);
  assert.throws(()=>selectReserve(parsed,[booking],date),e=>e.code==='NO_RESERVATION');
});

test('un historial inválido o una caída de API no se reporta como ausencia de reserva', async () => {
  assert.throws(()=>selectReserve(parsed,null,date),e=>e.code==='INVALID_HISTORY');
  await assert.rejects(findReservation(parsed,date,async()=>{throw new Error('HTTP 500');}),/HTTP 500/);
  assert.equal(reservationNotice('INVALID_HISTORY'),undefined);
});

test('acepta hoy, ayer y anteayer, pero rechaza tres días y fechas futuras', () => {
  for (const day of ['2026-11-15','2026-11-14','2026-11-13']) {
    const booking={...reserve,dateToPlay:day};
    assert.equal(selectReserve(parsed,[booking],date),booking);
  }
  assert.throws(()=>selectReserve(parsed,[{...reserve,dateToPlay:'2026-11-12'}],date),e=>e.code==='TOO_OLD');
  assert.throws(()=>selectReserve(parsed,[{...reserve,dateToPlay:'2026-11-16'}],date),e=>e.code==='NO_RESERVATION');
  assert.throws(()=>selectReserve(parsed,[reserve,{...reserve,dateToPlay:'2026-11-14'}],date),e=>e.code==='AMBIGUOUS_RESERVATION');
  assert.equal(selectReserve(parsed,[{...reserve,dateToPlay:'2026-10-31'}],'2026-11-02').dateToPlay,'2026-10-31');
});

test('el orden de singles en la reserva no cambia ganador y perdedor', () => {
  const reversed={...reserve,player1:reserve.player2,player2:reserve.player1};
  assert.equal(selectReserve(parsed,[reversed],date),reversed);
  assert.equal(parsed.winner[0].namePlayer,'Jugador Uno');
  assert.equal(parsed.looser[0].namePlayer,'Jugador Dos');
});
