import {normalize} from './parser.mjs';

export function recoverableMessage(message, startedAt, journal) {
  if(message.type!=='chat' || !Number.isFinite(message.timestamp) || message.timestamp<startedAt) return false;
  if(message.body.startsWith('[Bot escalerilla]') || journal[message.id._serialized]) return false;
  const result=/\d+\s*[-:/]\s*\d+/.test(message.body) && /\s+a\s+/.test(message.body);
  const confirmation=message.hasQuotedMsg && ['si','no'].includes(normalize(message.body));
  return Boolean(result || confirmation);
}
