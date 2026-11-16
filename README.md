# Tennis WhatsApp Bot

Bot independiente que lee resultados de tenis en un grupo de WhatsApp y consulta el backend de Tennis App para asociarlos a una reserva y registrar el resultado mediante `POST /match-ranking`.

**Estado actual: versión local en modo prueba por defecto. No está desplegado en Heroku.** La sesión, los resultados y los alias ya usan MongoDB. La autenticación del backend y el empaquetado para Heroku siguen pendientes para producción.

## Comportamiento

- Interpreta singles y dobles con la convención `ganador(es) a perdedor(es) marcador`.
- Acepta iniciales y nombres completos cuando identifican a un único jugador del padrón.
- Lee marcadores como `6-2 6-2`, `6/2 6/2` o `6-4/3-6/10-6`.
- Exige una única reserva de ranking activa y pendiente, para los mismos participantes y con una antigüedad máxima de dos días calendario en Chile.
- Responde primero “📩 Resultado recibido. Validando…”.
- Si no encuentra una reserva, responde: “⚠️ No se encontró un partido agendado para esos jugadores dentro de los dos días permitidos. Este resultado no será considerado.”
- En modo de registro real, los mensajes anteriores al arranque no se procesan automáticamente.
- Solo después de una respuesta exitosa del backend confirma “✅ Resultado ya ingresado”.
- En modo prueba no envía el POST y avisa que no se modificaron puntos.
- Ignora reenvíos con los mismos jugadores, marcador y fecha, incluso con cambios de separadores o nombres abreviados. Los duplicados se ignoran sin responder.

El cálculo de puntos pertenece al backend. El bot no confirma la aceptación del resultado por parte del rival. La antigüedad se calcula desde la fecha de la reserva hasta el día de validación en `America/Santiago`: se admiten hoy, ayer y anteayer, y se rechazan fechas futuras. Si hay más de una reserva válida dentro de ese período, se requiere revisión manual. El texto no puede alterar la fecha de la reserva.

## Validación de la reserva para ranking

Antes de registrar un resultado, la reserva del backend debe cumplir todas estas condiciones:

1. Existir y estar activa (`state: true`).
2. Haber sido creada para ranking (`isForRanking: true`). Una reserva de cancha común no habilita el registro en la escalerilla.
3. Corresponder a todos los jugadores y la modalidad singles/dobles, y haberse jugado hoy, ayer o anteayer según `America/Santiago`. No se admiten reservas futuras ni de hace más de dos días.
4. Estar pendiente de resultado (`resultMatchUpdated: false`) y no tener un resultado guardado.
5. Ser la única reserva que cumple esas condiciones; si hay varias, se requiere revisión.

La búsqueda consulta `GET /court-reserve/history/:namePlayer`, que incluye partidos cuyo horario ya terminó. No usa el listado general de reservas, que oculta horarios finalizados. El historial actual no incluye `isDouble`; cuando falta, se infiere la modalidad por la cantidad de participantes.

El bot distingue reservas inexistentes, inactivas, no creadas para ranking, ya ingresadas y múltiples coincidencias. Un fallo al consultar el backend se informa como pendiente de revisión, no como ausencia de reserva.

Si la reserva existe pero no es de ranking, responde:

> ⚠️ El partido está agendado, pero no fue creado para ranking. El resultado no fue ingresado.

Si el partido supera los dos días, responde “⚠️ El partido tiene más de dos días de jugado. El resultado no fue ingresado.”

En singles, el jugador antes de “a” es el ganador y el siguiente es el perdedor. La búsqueda compara participantes sin depender de su orden en la reserva; invertir player1/player2 no cambia quién ganó.

Si no hay reserva válida, no se envía el POST ni se modifican puntos. Antes de producción, estas validaciones también deben ejecutarse en el backend para que no dependan únicamente del bot.

## Confirmación de apodos en el grupo

Si un nombre no se identifica y hay una única coincidencia por prefijo del nombre y apellido, el bot pregunta antes de usarla. Por ejemplo:

> ¿Con “Maxi Galleguillos” te refieres a “Maximiliano Galleguillos”? Quien envió el resultado debe responder “sí” o “no” citando esta pregunta. El resultado queda pendiente; aún no se ha ingresado.

Solo se acepta la respuesta del autor del resultado, citando la pregunta correspondiente, dentro de 24 horas. Un “sí” guarda el alias para ese grupo en `bot_aliases` de MongoDB y reanuda la validación del mensaje original. Un “no” descarta la propuesta y pide reenviar el resultado con el nombre correcto. No se elige automáticamente entre varios candidatos y no se guardan alias sin confirmación.

Los alias y las consultas pendientes se conservan en MongoDB tras reinicios. Confirmar el nombre no registra el resultado: siguen siendo obligatorias una reserva válida de ranking, la antigüedad máxima de dos días y las comprobaciones de duplicados. No se vuelven a preguntar automáticamente nombres de mensajes históricos al iniciar el bot.

## Ejecución local

Requisitos: Node.js 26 LTS (seleccionar con `nvm use` si usas nvm), acceso a MongoDB y al backend, y Chrome compatible con Puppeteer. El bot no escucha un puerto HTTP propio; realiza conexiones salientes. El backend local de ejemplo escucha en el puerto 3500.

```sh
npm ci
cp .env.example .env
npm test
npm start
```

Completar `MONGODB_URI`, `API_BASE_URL` y `WHATSAPP_GROUP_NAME` o `WHATSAPP_GROUP_ID` en `.env`. El nombre debe identificar un único grupo. Si se dejan ambos vacíos, el bot lista los grupos disponibles. Para usar Chrome instalado, configurar `CHROME_PATH` con la ruta al ejecutable.

Vincular el número dedicado escaneando el QR desde WhatsApp → Dispositivos vinculados. Agregarlo al grupo antes de seleccionar el grupo. Mantener `DRY_RUN=true` para probar. El bot puede responder en WhatsApp en modo prueba, pero no modifica puntos.

No ejecutar una segunda instancia usando la misma sesión. No refrescar manualmente la ventana de Chrome del bot: puede perder la conexión con el lector.

## Configuración

| Variable | Uso |
| --- | --- |
| `API_BASE_URL` | URL del backend. |
| `MONGODB_URI` | Conexión privada de MongoDB, solo en `.env` o secretos del servidor. |
| `MONGODB_DATABASE` | Base usada para el bot; por defecto `Tennis`. |
| `API_TOKEN` | Credencial Bearer si el backend la admite; no crea autenticación por sí misma. |
| `WHATSAPP_GROUP_ID` | ID del único grupo permitido; tiene prioridad sobre el nombre. |
| `WHATSAPP_GROUP_NAME` | Nombre del grupo, cuando no se conoce su ID. |
| `DRY_RUN` | `true` por defecto; únicamente `false` habilita escrituras. |
| `CHROME_PATH` | Ruta opcional al ejecutable de Chrome. |
| `WHATSAPP_HEADLESS` | `false` para ver Chrome; otros valores lo ejecutan sin ventana. |

`CHECK_RECENT=true` permite revisar los últimos tres mensajes de los últimos treinta minutos, solo en modo prueba. Puede generar respuestas en el grupo. No está activado por defecto. `ACK_MESSAGE_ID` es una herramienta de operación para responder una sola vez a un mensaje previamente revisado del grupo configurado; no usar durante arranques normales.

## Estado persistente y fallos

La sesión, el diario y los alias se guardan en MongoDB. `RemoteAuth` usa un adaptador propio compatible con su interfaz: guarda manifiesto y fragmentos de sesión en una sola colección, incluso si el archivo supera 16 MB. El directorio `.wwebjs_auth/` se usa como espacio de trabajo de Chrome; la copia remota permite restaurar la sesión al iniciar. El evento `remote_session_saved` confirma un respaldo inicial y luego se intenta respaldar cada 60 segundos. La compresión y la subida se serializan: si una copia sigue en curso, no se inicia otra.

Se mantiene un bloqueo renovable dentro de `bot_sessions`: una segunda instancia no puede iniciar con la misma sesión. Si pierde el acceso a MongoDB o el bloqueo, el bot se detiene. La migración del diario local usa inserciones que no sobrescriben estados remotos existentes.

Para migrar una instancia anterior: detener primero el bot y su Chrome; ejecutar `node --env-file=.env migrate-local.mjs` desde la carpeta que contiene `state/` y `.wwebjs_auth/session-tennis-results`; después iniciar el bot normalmente. La sesión original se conserva y la migración no sobrescribe una sesión remota existente. Los archivos locales del diario quedan solo como respaldo de migración, no reciben nuevas escrituras.

`.env`, `.wwebjs_auth/`, `.wwebjs_cache/`, `state/`, archivos ZIP y `node_modules/` están excluidos de Git. No compartir el QR ni la URI. La sesión remota permite acceso a WhatsApp: restringir el usuario de base y proteger las copias de seguridad.

Los estados `uncertain` requieren revisar reserva, resultado y puntos antes de reintentar: el backend podría haber aplicado cambios aunque se haya perdido la respuesta. No borrar el diario para forzar reintentos. Los pendientes no se reprocesan automáticamente. Si se crea después una reserva para un pendiente, requiere revisión manual para permitir un nuevo intento.

El endpoint actual del backend aplica puntos y guarda resultados sin una transacción compartida. La protección local contra duplicados no cubre escrituras concurrentes desde el frontend u otro proceso. La idempotencia y la atomicidad deben implementarse también en el backend antes de activar producción.

## Persistencia en MongoDB

Se crean exclusivamente estas tres colecciones en la base configurada (`Tennis` por defecto):

| Colección | Contenido |
| --- | --- |
| `bot_sessions` | Sesión de WhatsApp por manifiesto y fragmentos, y un bloqueo renovable de instancia. |
| `bot_results` | ID único de mensaje, estado, clave de duplicado, reserva asociada cuando existe, confirmaciones pendientes y estado de respuestas. |
| `bot_aliases` | Alias normalizado y correo del jugador, únicos por grupo y alias. |

No se copia el padrón completo ni se escriben reservas, categorías o puntos directamente. Los resultados continúan ingresándose mediante el backend. Las pruebas locales verifican fragmentación e integridad de sesión, migración sin sobrescrituras, recuperación de alias y bloqueo de otra instancia.

## Heroku

Heroku puede ejecutar este bot como un proceso `worker` independiente. Antes de desplegar hay que:

1. Configurar la URI privada de MongoDB; RemoteAuth y el adaptador remoto ya están implementados.
2. Verificar la restauración de la sesión y el diario desde MongoDB en el nuevo entorno; no ejecutar simultáneamente la instancia local.
3. Preparar una imagen Linux con Node y Chrome para ejecución sin ventana y revisar las dependencias.
4. Implementar credenciales restringidas, validación e idempotencia en el backend.
5. Configurar URL HTTPS del backend, secretos y grupo permitido en Heroku Config Vars.
6. Ejecutar un solo worker, detener el bot local y vincular el número en el servidor.
7. Validar inicialmente sin escrituras y habilitar el registro real tras probar el flujo completo.

No subir `.env` ni sesión de WhatsApp a GitHub. El disco de Heroku es efímero: MongoDB conserva los datos del bot y Chrome usa el disco temporal como espacio de trabajo. El arranque del proyecto permite usar variables del servidor sin exigir un archivo `.env`.

Referencias: [dynos de Heroku](https://devcenter.heroku.com/articles/dynos), [almacenamiento efímero](https://help.heroku.com/K1PPS2WM/why-are-my-file-uploads-missing-deleted-from-the-application), [whatsapp-web.js](https://wwebjs.dev/).

La conexión mediante WhatsApp Web no es oficial y puede desconectarse o sufrir bloqueos. Esta versión no incluye licencia para redistribución; el repositorio no añade una licencia automáticamente.
