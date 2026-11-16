import {selectReserve} from './parser.mjs';

export async function findReservation(parsed, date, api) {
  // El listado general oculta partidos terminados. El historial no filtra por hora.
  const name = encodeURIComponent(parsed.winner[0].namePlayer);
  const history = await api(`/court-reserve/history/${name}`);
  return selectReserve(parsed, history, date);
}

export function reservationNotice(code) {
  return {
    NO_RESERVATION: '⚠️ No hay un partido agendado para esos jugadores en la fecha del mensaje. El resultado no fue ingresado.',
    NOT_RANKING: '⚠️ El partido está agendado, pero no fue creado para ranking. El resultado no fue ingresado.',
    INACTIVE_RESERVATION: '⚠️ El partido no tiene una reserva activa. El resultado no fue ingresado.',
    ALREADY_RECORDED: '⚠️ El partido ya tiene un resultado registrado. Este resultado no fue ingresado nuevamente.',
    AMBIGUOUS_RESERVATION: '⚠️ Hay más de un partido agendado pendiente para esos jugadores en esa fecha. Se requiere revisión; el resultado no fue ingresado.',
  }[code];
}
