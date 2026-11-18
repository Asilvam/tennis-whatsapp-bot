export function browserOptions(env=process.env) {
  return {
    headless:env.WHATSAPP_HEADLESS!=='false',
    ...(env.CHROME_PATH?{executablePath:env.CHROME_PATH}:{}),
    ...(env.CHROME_NO_SANDBOX==='true'?{args:['--no-sandbox','--disable-setuid-sandbox']}:{}),
  };
}

export function authenticationTimeout(env=process.env) {
  const value=Number(env.WHATSAPP_AUTH_TIMEOUT_MS || 30000);
  if(!Number.isInteger(value)||value<30000||value>300000)throw new Error('WHATSAPP_AUTH_TIMEOUT_MS debe estar entre 30000 y 300000 milisegundos.');
  return value;
}
