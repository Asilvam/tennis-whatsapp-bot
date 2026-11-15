import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parse, selectReserve} from './parser.mjs';
const roster = ['Vicente Pachi','Vicente Illesca','Kevin Gago','Luis Oyarzun','Jaime Marambio','Ignacio Lizana','Felipe Leiva','Juan Caballero','Matias Galleguillos','Maximiliano Galleguillos','Alejandro Silva','Andres Kafati'].map((namePlayer,i) => ({namePlayer,email:String(i)}));
const messages = [
 'V pachi V illesca a K gago L oyarzun 6-2 , 3-6 , 6-4 🫶',
 'J Marambio a I Lizana 6-4/3-6/10-6 buen partido Jaimito pa la prox 3 normales🦾',
 'F. Leiva a J. Caballero 6-2 6-2',
 'Matias galleguillos Maximiliano Galleguillos a A silva A kafati 6-3 4-6 10-3',
];
test('interpreta los cuatro formatos con un padrón ficticio', () => {
  assert.deepEqual(messages.map(m => parse(m,roster).winner.length), [2,1,1,2]);
  assert.equal(parse(messages[1],roster).result,'6:4, 3:6, 10:6');
});
test('rechaza nombres ambiguos y marcadores inválidos', () => {
  assert.throws(() => parse(messages[2],[...roster,{namePlayer:'Francisco Leiva',email:'otro'}]));
  for (const score of ['6-2 2-6','6-2 6-2 6-2','6-2 9-1','2-6 2-6']) assert.throws(() => parse(`F Leiva a J Caballero ${score}`,roster));
  assert.equal(parse('buen partido',roster),null);
});
test('exige reserva única, del mismo día, pendiente y de ranking', () => {
  const parsed = parse(messages[2],roster);
  const reserve = {state:true,isForRanking:true,resultMatchUpdated:false,isDouble:false,dateToPlay:'2026-11-15',player1:'Felipe Leiva',player2:'Juan Caballero'};
  assert.equal(selectReserve(parsed,[reserve],'2026-11-15'),reserve);
  assert.throws(() => selectReserve(parsed,[reserve,reserve],'2026-11-15'));
  assert.throws(() => selectReserve(parsed,[reserve],'2026-11-14'));
  assert.throws(() => selectReserve(parsed,[{...reserve,resultMatchUpdated:true}],'2026-11-15'));
});

test('acepta barras dentro de cada set', () => {
  const parsed = parse('Luis Enrique Lavín a Alejandro Silva 7/6 6/7 7/6', [{namePlayer:'Luis Enrique Lavín',email:'luis'},{namePlayer:'Alejandro Silva',email:'alejandro'}]);
  assert.equal(parsed.result,'7:6, 6:7, 7:6');
});

test('detecta repetidos con iniciales, nombres completos y separadores distintos', async () => {
  const {resultKey} = await import('./parser.mjs');
  const a = parse('F Leiva a J Caballero 6/2 6/2',roster);
  const b = parse('Felipe Leiva a Juan Caballero 6-2, 6-2 buen partido',roster);
  assert.equal(resultKey(a,'grupo','2026-11-15'),resultKey(b,'grupo','2026-11-15'));
  assert.notEqual(resultKey(a,'grupo','2026-11-15'),resultKey(b,'grupo','2026-11-16'));
  const doubles = parse(messages[0],roster);
  const reordered = {...doubles,winner:[...doubles.winner].reverse()};
  assert.equal(resultKey(doubles,'grupo','hoy'),resultKey(reordered,'grupo','hoy'));
});
