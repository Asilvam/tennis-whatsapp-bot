# Tennis WhatsApp Bot

Bot independiente que lee resultados de tenis en un grupo de WhatsApp y consulta el backend de Tennis App para asociarlos a una reserva y registrar el resultado mediante `POST /match-ranking`.

**Estado actual: versión local en modo prueba por defecto. No está desplegado en Heroku.** La autenticación del backend y el almacenamiento externo de la sesión y el diario están pendientes para producción.

## Comportamiento

- Interpreta singles y dobles con la convención `ganador(es) a perdedor(es) marcador`.
- Acepta iniciales y nombres completos cuando identifican a un único jugador del padrón.
- Lee marcadores como `6-2 6-2`, `6/2 6/2` o `6-4/3-6/10-6`.
- Exige una única reserva de ranking activa y pendiente, para los mismos participantes y la fecha del mensaje en Chile.
- Responde primero “📩 Resultado recibido. Validando…”.
- Sin reserva responde que no hay un partido agendado y pendiente de resultado para esos jugadores en esa fecha.
- Solo después de una respuesta exitosa del backend confirma “✅ Resultado ya ingresado”.
- En modo prueba no envía el POST y avisa que no se modificaron puntos.
- Ignora reenvíos con los mismos jugadores, marcador y fecha, incluso con cambios de separadores o nombres abreviados. Los duplicados se ignoran sin responder.

El cálculo de puntos pertenece al backend. El bot no confirma la aceptación del resultado por parte del rival. La fecha se toma del mensaje: indicar otra fecha en el texto aún requiere revisión manual.

## Ejecución local

Requisitos: Node.js 22, acceso al backend y Chrome compatible con Puppeteer.

```sh
npm ci
cp .env.example .env
npm test
npm start
```

Completar `API_BASE_URL` y `WHATSAPP_GROUP_NAME` o `WHATSAPP_GROUP_ID` en `.env`. El nombre debe identificar un único grupo. Si se dejan ambos vacíos, el bot lista los grupos disponibles. Para usar Chrome instalado, configurar `CHROME_PATH` con la ruta al ejecutable.

Vincular el número dedicado escaneando el QR desde WhatsApp → Dispositivos vinculados. Agregarlo al grupo antes de seleccionar el grupo. Mantener `DRY_RUN=true` para probar. El bot puede responder en WhatsApp en modo prueba, pero no modifica puntos.

No ejecutar una segunda instancia usando la misma sesión. No refrescar manualmente la ventana de Chrome del bot: puede perder la conexión con el lector.

## Configuración

| Variable | Uso |
| --- | --- |
| `API_BASE_URL` | URL del backend. |
| `API_TOKEN` | Credencial Bearer si el backend la admite; no crea autenticación por sí misma. |
| `WHATSAPP_GROUP_ID` | ID del único grupo permitido; tiene prioridad sobre el nombre. |
| `WHATSAPP_GROUP_NAME` | Nombre del grupo, cuando no se conoce su ID. |
| `DRY_RUN` | `true` por defecto; únicamente `false` habilita escrituras. |
| `CHROME_PATH` | Ruta opcional al ejecutable de Chrome. |
| `WHATSAPP_HEADLESS` | `false` para ver Chrome; otros valores lo ejecutan sin ventana. |

`CHECK_RECENT=true` permite revisar los últimos tres mensajes de los últimos treinta minutos, solo en modo prueba. Puede generar respuestas en el grupo. No está activado por defecto. `ACK_MESSAGE_ID` es una herramienta de operación para responder una sola vez a un mensaje previamente revisado del grupo configurado; no usar durante arranques normales.

## Estado persistente y fallos

La sesión se guarda en `.wwebjs_auth/`, la caché en `.wwebjs_cache/` y el diario de mensajes y duplicados en `state/`. Estos directorios, `.env` y `node_modules/` están excluidos de Git. No compartir el QR ni las carpetas de sesión.

Los estados `uncertain` requieren revisar reserva, resultado y puntos antes de reintentar: el backend podría haber aplicado cambios aunque se haya perdido la respuesta. No borrar el diario para forzar reintentos. Los pendientes no se reprocesan automáticamente. Si se crea después una reserva para un pendiente, requiere revisión manual para permitir un nuevo intento.

El endpoint actual del backend aplica puntos y guarda resultados sin una transacción compartida. La protección local contra duplicados no cubre escrituras concurrentes desde el frontend u otro proceso. La idempotencia y la atomicidad deben implementarse también en el backend antes de activar producción.

## Heroku

Heroku puede ejecutar este bot como un proceso `worker` independiente. Antes de desplegar hay que:

1. Cambiar LocalAuth por una estrategia de sesión remota compatible con whatsapp-web.js y almacenamiento externo privado.
2. Mover el diario y la deduplicación fuera del disco temporal del dyno.
3. Preparar una imagen Linux con Node y Chrome para ejecución sin ventana y revisar las dependencias.
4. Implementar credenciales restringidas, validación e idempotencia en el backend.
5. Configurar URL HTTPS del backend, secretos y grupo permitido en Heroku Config Vars.
6. Ejecutar un solo worker, detener el bot local y vincular el número en el servidor.
7. Validar inicialmente sin escrituras y habilitar el registro real tras probar el flujo completo.

No subir `.env` ni sesión de WhatsApp a GitHub para conservarlas en Heroku. Su disco es efímero y se reinicia: guardar ahí el único historial o sesión pierde persistencia. El arranque del proyecto permite usar variables del servidor sin exigir un archivo `.env`.

Referencias: [dynos de Heroku](https://devcenter.heroku.com/articles/dynos), [almacenamiento efímero](https://help.heroku.com/K1PPS2WM/why-are-my-file-uploads-missing-deleted-from-the-application), [whatsapp-web.js](https://wwebjs.dev/).

La conexión mediante WhatsApp Web no es oficial y puede desconectarse o sufrir bloqueos. Esta versión no incluye licencia para redistribución; el repositorio no añade una licencia automáticamente.
