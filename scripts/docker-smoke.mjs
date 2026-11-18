import puppeteer from 'puppeteer';
import mongoose from 'mongoose';
import {browserOptions} from '../browser-config.mjs';

console.log('Node:',process.version);
const browser=await puppeteer.launch(browserOptions());
try {
  const page=await browser.newPage();
  await page.setContent('<title>Bot Docker OK</title>');
  if(await page.title()!=='Bot Docker OK')throw new Error('Falló la prueba de Chromium');
  console.log('Chromium:',await browser.version());
}finally{await browser.close();}

const response=await fetch(`${process.env.API_BASE_URL.replace(/\/$/,'')}/healthz`,{signal:AbortSignal.timeout(10000)});
if(!response.ok)throw new Error(`Backend HTTP ${response.status}`);
console.log('Backend local: OK');
if(process.env.MONGODB_URI) {
  let connection;
  try {
    connection=await mongoose.createConnection(process.env.MONGODB_URI,{dbName:process.env.MONGODB_DATABASE||'Tennis',serverSelectionTimeoutMS:10000}).asPromise();
    await connection.db.command({ping:1});
    console.log('MongoDB: conexión OK (solo ping)');
  }catch(error){console.error('MongoDB: falló la conexión; tipo:',error.name);process.exitCode=1;}
  finally{if(connection)await connection.close();}
}
console.log('Prueba terminada: no se vinculó WhatsApp ni se ingresaron resultados.');
