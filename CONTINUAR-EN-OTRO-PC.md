# Seguir con este proyecto desde otro ordenador

Todo el código y la documentación están en GitHub. Lo único que **no**
viaja por ahí son dos ficheros con secretos, a propósito: están en
`.gitignore` porque dan control total sobre WhatsApp, la base de datos y
la cuenta de OpenAI.

## 1. Clonar (5 minutos)

```bash
mkdir -p ~/Projects && cd ~/Projects
git clone git@github.com:erwingfhq/wacrm.git
cd wacrm && npm ci
```

Si `git@` falla, es que ese ordenador no tiene clave SSH en GitHub. Usa
`https://github.com/erwingfhq/wacrm.git` y GitHub pedirá usuario y un
token personal.

**Importante: NO lo pongas en el Escritorio ni en Documentos si esas
carpetas están sincronizadas con iCloud.** macOS vacía los ficheros que
llevan días sin abrirse y los vuelve a bajar uno a uno; la misma batería
de pruebas pasó de **2,6 segundos** a **339** por ese motivo, y una vez
abortó un `git commit` a medias. `~/Projects` está fuera de iCloud.

## 2. Llevar los dos ficheros de secretos

| Fichero | Qué contiene |
|---|---|
| `.env.local` | Claves de Supabase, `ENCRYPTION_KEY`, `META_APP_SECRET` |
| `.env.whatsapp-token` | Copia del token permanente de Meta (Meta solo lo enseña una vez) |

Van en la **raíz** del proyecto clonado.

Cómo pasarlos, de mejor a peor:

- **Gestor de contraseñas** (1Password, Bitwarden): pega el contenido en
  una nota segura y cópialo en el otro ordenador. Es lo más limpio.
- **AirDrop** entre tus Macs, o un USB que luego borres.
- **Nunca** por correo, WhatsApp, Slack o un repositorio. Quien los tenga
  puede leer todas las conversaciones y mandar mensajes como tu negocio.

Comprueba que llegaron bien:

```bash
chmod 600 .env.local .env.whatsapp-token
grep -c . .env.local          # debe dar 9 líneas con contenido
npx vitest run                # 683 pruebas en verde
```

Si `ENCRYPTION_KEY` no coincide exactamente con el original, la app
arranca pero **no podrá descifrar el token de WhatsApp ni la clave de
OpenAI** — el síntoma es que el bot deja de responder sin error claro.

## 3. Ponerte al día

Todo el contexto está escrito, no hace falta recordar nada:

| Documento | Qué cuenta |
|---|---|
| `SETUP-ES.md` | El manual completo: Supabase, correo, Meta, el agente de IA, la política de precios y los fallos que costaron tiempo |
| `deploy/homelab/README-ES.md` | La guía paso a paso del traslado al homelab |
| `git log` | Cada commit explica **por qué** se hizo el cambio, no solo qué cambió |

## 4. Al empezar con Claude en el otro ordenador

Ábrelo con la carpeta `~/Projects/wacrm` y dile algo como:

> Lee SETUP-ES.md y deploy/homelab/README-ES.md. Vamos a montar el CRM en
> mi homelab siguiendo esa guía.

Con eso tiene el estado completo del proyecto.

## Dónde está cada cosa hoy

| Pieza | Dónde |
|---|---|
| Código | `github.com/erwingfhq/wacrm` |
| App en producción | Hostinger → <https://ngsignscrm.com> |
| Base de datos | Supabase cloud, proyecto `xpdqviimqppprxmblytl` (plan **Free**) |
| WhatsApp | App de Meta `1019685967553848`, número de prueba +1 555 161 0572 |
| Prompt del agente | En la base de datos (`ai_configs`), se edita con `scripts/set-agent-prompt.mjs` |

⚠️ **Supabase Free pausa el proyecto tras 7 días sin tráfico** y le retira
el DNS. La app sigue mostrando el login pero no funciona nada, y los
mensajes de WhatsApp de ese periodo **se pierden**. Ya pasó una vez, entre
agosto y septiembre de 2026. Se reanuda desde el panel de Supabase.
