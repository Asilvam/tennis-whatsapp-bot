import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parse,normalize} from './parser.mjs';
import {suggestAlias,confirmationAnswer} from './aliases.mjs';

const roster=[['Victor Barrera','a'],['Maximiliano Galleguillos','b'],['Aldo Morel','c'],['Luis Galleguillos','d']].map(([namePlayer,email])=>({statePlayer:true,namePlayer,email}));
const text='Victor Barrera Maxi Galleguillos a Aldo Morel Luis Galleguillos 6/3 7/5';

test('propone un apodo único en dobles sin aceptarlo automáticamente', () => {
  let error;
  try {parse(text,roster);} catch(e) {error=e;}
  assert.ok(error);
  const suggestion=suggestAlias(error.teamText,roster);
  assert.deepEqual(suggestion,{label:'Maxi Galleguillos',name:'Maximiliano Galleguillos',email:'b'});
  const confirmed=JSON.parse(JSON.stringify({[normalize(suggestion.label)]:suggestion.email}));
  assert.deepEqual(parse(text,roster,confirmed).winner.map(p=>p.email),['a','b']);
  assert.throws(()=>parse(text,roster));
});

test('no propone identidades ambiguas, desconocidas ni apodos de una letra', () => {
  assert.equal(suggestAlias('Maxi Galleguillos',[...roster,{statePlayer:true,namePlayer:'Maximo Galleguillos',email:'e'}]),null);
  assert.equal(suggestAlias('Pepe Desconocido',roster),null);
  assert.equal(suggestAlias('X Galleguillos',roster),null);
});

test('solo acepta sí/no del autor, citando la pregunta vigente', () => {
  const pending={status:'needs_confirmation',sender:'author',questionId:'question',expiresAt:200};
  const message={body:'Sí!',author:'author',fromMe:false};
  assert.equal(confirmationAnswer(message,pending,'question',100),true);
  assert.equal(confirmationAnswer({...message,body:'no'},pending,'question',100),false);
  assert.equal(confirmationAnswer({...message,author:'other'},pending,'question',100),null);
  assert.equal(confirmationAnswer(message,pending,'another',100),null);
  assert.equal(confirmationAnswer(message,pending,'question',201),null);
  assert.equal(confirmationAnswer(message,{...pending,status:'sent'},'question',100),null);
  assert.equal(confirmationAnswer({...message,body:'tal vez'},pending,'question',100),null);
});


test('propone una inicial con apellido parecido y exige confirmación antes de parsear', () => {
  const people=[{statePlayer:true,namePlayer:'Fernando Andrés Villarroel Soto',email:'fernando'},{statePlayer:true,namePlayer:'Martina Villarroel',email:'martina'},...roster];
  const suggestion=suggestAlias('F. Villarruel',people);
  assert.deepEqual(suggestion,{label:'F. Villarruel',name:'Fernando Andrés Villarroel Soto',email:'fernando'});
  const message='F. Villarruel a Victor Barrera 6/3 6/4';
  assert.throws(()=>parse(message,people));
  assert.equal(parse(message,people,{[normalize(suggestion.label)]:suggestion.email}).winner[0].email,'fernando');
});

test('no decide entre varias coincidencias parecidas ni inventa una inicial', () => {
  const people=[{statePlayer:true,namePlayer:'Fernando Villarroel',email:'one'},{statePlayer:true,namePlayer:'Felipe Villarroel',email:'two'}];
  assert.equal(suggestAlias('F. Villarruel',people),null);
  assert.equal(suggestAlias('J. Villarruel',people),null);
  assert.equal(suggestAlias('F. Perez',people),null);
});


test('sugiere solo jugadores activos y excluye también los de estado desconocido',()=>{
 const players=[
  {namePlayer:'Fernando Villarroel',email:'active',statePlayer:true},
  {namePlayer:'Felipe Villarroel',email:'inactive',statePlayer:false},
  {namePlayer:'Francisco Villarroel',email:'unknown'},
 ];
 assert.equal(suggestAlias('F Villarruel',players).email,'active');
 assert.equal(suggestAlias('F Villarruel',players.filter(p=>p.email!=='active')),null);
});
