import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parse,normalize} from './parser.mjs';
import {suggestAlias,confirmationAnswer} from './aliases.mjs';

const roster=[['Victor Barrera','a'],['Maximiliano Galleguillos','b'],['Aldo Morel','c'],['Luis Galleguillos','d']].map(([namePlayer,email])=>({namePlayer,email}));
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
  assert.equal(suggestAlias('Maxi Galleguillos',[...roster,{namePlayer:'Maximo Galleguillos',email:'e'}]),null);
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
