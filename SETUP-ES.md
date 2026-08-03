# Puesta en marcha de wacrm — guía paso a paso

Estado actual de esta copia:

- [x] Repo clonado y dependencias instaladas (`npm install`, Node 24)
- [x] `.env.local` creado con `ENCRYPTION_KEY` y `AUTOMATION_CRON_SECRET` ya generados
- [x] `supabase/ALL_MIGRATIONS.sql` — las 36 migraciones concatenadas en orden
- [x] Servidor de desarrollo verificado (login carga, `npm run typecheck` limpio)
- [x] **Supabase listo** — org `wacrm` (Free), proyecto ref `xpdqviimqppprxmblytl`,
      región East US (N. Virginia). 36 migraciones aplicadas, RLS verificado,
      claves API en `.env.local` y probadas contra la API real.
- [x] Usuario creado en el CRM (erwingfidelio@aol.com) y dentro del dashboard
- [x] **SMTP propio configurado y verificado** — ver "Configuración de correo" abajo
- [ ] App de Meta / WhatsApp → **paso 3**
- [ ] Deploy en Hostinger → **paso 4**

## Configuración de correo (hecha)

Dominio `ngsignscrm.com`, registrado en Hostinger. Buzón real (no `noreply`)
para que las respuestas de clientes no se pierdan.

| Ajuste | Valor |
|---|---|
| Host | `smtp.hostinger.com` |
| Puerto | `465` (SSL implícito) |
| Usuario | `crm@ngsignscrm.com` |
| Remitente | `crm@ngsignscrm.com` — "NG Signs CRM" |
| Webmail | <https://mail.hostinger.com> |

DNS verificado por `dig`: **MX** (mx1/mx2.hostinger.com), **SPF**
(`v=spf1 include:_spf.mail.hostinger.com ~all`), **DKIM**
(`hostingermail-a._domainkey` → clave RSA) y **DMARC** (`v=DMARC1; p=none`).

Avisos:

- **El plan de email expira el 2027-08-03.** La auto-renovación está
  desactivada a propósito (renovaría a $7,08/año). Si para entonces el CRM
  está en producción, hay que reactivarla o el buzón deja de enviar y recibir.
  La auto-renovación **del dominio** sí sigue activa: no la toques.
- Activar SMTP propio bajó el límite a **30 correos/hora**. Ajustable en
  Authentication → Rate Limits si hace falta una invitación masiva.
- Si sale `535 5.7.8 authentication failed` en los logs de Auth, es la
  contraseña del buzón, no el host ni el puerto. Se comprueba entrando al
  webmail con esas credenciales.

> El paso 1 (crear proyecto Supabase) ya está hecho; se deja documentado abajo
> como referencia por si algún día hay que rehacerlo o montar un entorno de
> staging.

> El puerto 3000 lo ocupa otra app tuya, así que el dev server arranca en otro
> puerto (ver la salida de `npm run dev`). Si liberas el 3000, vuelve a
> apuntar `NEXT_PUBLIC_SITE_URL` a `http://localhost:3000`.

---

## Paso 1 — Supabase (base de datos + login)

Es gratis en el plan free y es lo único que hace falta para que el CRM
arranque de verdad. WhatsApp puede esperar al paso 3.

1. Entra en <https://supabase.com> y crea una cuenta.
2. **New project**. Elige la región más cercana a tus usuarios (para España,
   `eu-west-3` o `eu-central-1`).
3. **Guarda la contraseña de la base de datos** que te muestra — no se vuelve
   a enseñar. Espera ~1 minuto a que se aprovisione.
4. Ve a **Project Settings → API** y copia tres valores:

   | En Supabase | En `.env.local` |
   |---|---|
   | Project URL | `NEXT_PUBLIC_SUPABASE_URL` |
   | `anon` / `public` key | `NEXT_PUBLIC_SUPABASE_ANON_KEY` |
   | `service_role` key | `SUPABASE_SERVICE_ROLE_KEY` |

   La `service_role` salta todas las reglas de seguridad por fila (RLS). Nunca
   la pegues en código de cliente ni la subas a Git. `.env*` ya está en
   `.gitignore`.

5. Pégalos en `.env.local`, sustituyendo los `your-...` de ejemplo.

### Cargar el esquema

6. En Supabase, **SQL Editor → New query**. Pega el contenido completo de
   `supabase/ALL_MIGRATIONS.sql` y pulsa **Run**.

   Son 5.000 líneas; si el editor se atraganta, ejecuta los archivos de
   `supabase/migrations/` uno a uno **en orden numérico** (001 → 036). El orden
   importa: las migraciones posteriores dependen de las tablas anteriores.

7. Comprueba en **Table Editor** que existen al menos: `profiles`, `contacts`,
   `conversations`, `messages`, `pipelines`, `broadcasts`, `automations`,
   `whatsapp_config`.

### Autenticación

8. **Authentication → Providers**: el proveedor **Email** debe estar activado.
9. **Authentication → Providers → Email**: desactiva "Confirm email" mientras
   pruebas en local (si no, no podrás entrar sin recibir el correo). Vuelve a
   activarlo antes de producción.
10. **Authentication → URL Configuration**: añade tu dominio de producción a la
    lista de *Redirect URLs* cuando llegues al paso 4.

### Probar

```bash
npm run dev
```

Abre la URL que imprime, pulsa **Create account**, regístrate con tu email y
entra. Ya tienes el CRM funcionando — inbox, contactos, pipelines y
automatizaciones — todo menos WhatsApp.

---

## Paso 2 — (Opcional) Asistente de IA

No necesita variable de entorno. Dentro del CRM, **Settings → AI Assistant**,
pega tu clave de OpenAI o de Anthropic. Se guarda cifrada con tu
`ENCRYPTION_KEY`. Sirve para borradores de respuesta, auto-respuesta con tope
por conversación y base de conocimiento.

---

## Paso 3 — WhatsApp Business API (Meta)

**Requisito previo importante:** el webhook de Meta necesita una URL pública
con HTTPS. En local no funciona salvo que abras un túnel (`ngrok http <puerto>`
o `cloudflared tunnel`). Si vas directo a Hostinger, haz el paso 4 primero y
vuelve aquí con tu dominio real.

También necesitas un número de teléfono que **no esté registrado en la app
normal de WhatsApp ni en WhatsApp Business**. Si lo está, hay que borrar esa
cuenta antes.

1. <https://developers.facebook.com> → **My Apps → Create App** → tipo
   **Business**.
2. Añade el producto **WhatsApp** y conéctalo a tu Business Manager.
3. En **App Settings → Basic** copia el **App Secret** →
   `META_APP_SECRET` en `.env.local`. Sin esto el webhook rechaza *todas* las
   peticiones (verifica la firma HMAC-SHA256).
   Copia también el **App ID** → `META_APP_ID`, necesario solo si vas a crear
   plantillas con cabecera de imagen.
4. En **WhatsApp → API Setup** copia el **Phone Number ID** y el **WhatsApp
   Business Account ID**.

### Token de producción

El token temporal de esa pantalla caduca en 24 h. Para producción:

5. **Business Settings → Users → System users → Add**. Nómbralo
   `wacrm-system-user`, rol **Admin**.
6. **Generate new token**, elige tu app y marca los permisos
   `whatsapp_business_management` y `whatsapp_business_messaging`.
7. Copia el token — **solo se muestra una vez**.

### Conectar en el CRM

8. En wacrm, **Settings → WhatsApp**: pega Phone Number ID, WhatsApp Business
   ID, el token de system user, y un **Verify token** que te inventes (cualquier
   cadena aleatoria larga; guárdala, la necesitas en el paso siguiente).
   El CRM cifra todo antes de guardarlo.

### Webhook en Meta

9. **WhatsApp → Configuration → Webhook → Edit**:
   - **Callback URL**: `https://<tu-dominio>/api/whatsapp/webhook`
   - **Verify token**: exactamente la misma cadena del paso 8.
10. **Manage** → suscríbete a estos campos:
    `messages`, `message_template_status_update`,
    `message_template_quality_update`, `message_template_components_update`.

11. Quita `WHATSAPP_TEMPLATES_DRY_RUN=true` de `.env.local` cuando quieras
    enviar plantillas de verdad a Meta (ahora está en modo simulación).

---

## Paso 4 — Deploy en Hostinger

1. **Haz un fork** de <https://github.com/ArnasDon/wacrm> en tu cuenta de
   GitHub. Hostinger despliega desde *tu* repo, no desde el original.
2. Reapunta esta copia local a tu fork:

   ```bash
   git remote set-url origin https://github.com/<tu-usuario>/wacrm.git
   ```

3. Contrata un plan **Managed Node.js** con al menos **2 GB de RAM** —
   `npm run build` de Next.js 16 se queda sin memoria por debajo de eso.
4. **hPanel → Websites → Create** → tipo **Node.js**:
   - Application name: `wacrm`
   - Application root: el que venga por defecto
   - Application URL: tu dominio (p. ej. `crm.tudominio.com`)
   - Node.js version: **20 o superior**
   - Start command: `npm start`
5. En la sección **Git**, pega la URL HTTPS de tu fork, rama `main`, y el mismo
   deploy path que el application root.
6. **Environment variables** en hPanel — añade *antes* de construir:

   | Variable | De dónde sale |
   |---|---|
   | `NEXT_PUBLIC_SUPABASE_URL` | Supabase (paso 1) |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase (paso 1) |
   | `SUPABASE_SERVICE_ROLE_KEY` | Supabase (paso 1) |
   | `ENCRYPTION_KEY` | **cópialo tal cual de tu `.env.local`** |
   | `META_APP_SECRET` | Meta (paso 3) |
   | `NEXT_PUBLIC_SITE_URL` | `https://crm.tudominio.com` (sin barra final) |
   | `AUTOMATION_CRON_SECRET` | cópialo de tu `.env.local` |
   | `NEXT_PUBLIC_APP_LOCALE` | `en` |

   ⚠️ **Las `NEXT_PUBLIC_*` se incrustan en el bundle durante el build.** Si las
   añades después, hay que reconstruir para que surtan efecto.

   ⚠️ **No cambies `ENCRYPTION_KEY` una vez en producción.** Rotarla deja
   ilegibles todos los tokens cifrados y hay que reconectar WhatsApp a mano.

7. Construye: `npm ci` y luego `npm run build` desde el terminal o los botones
   de hPanel.
8. El SSL se provisiona solo (1–2 min en subdominios).
9. Vuelve a Supabase → **Authentication → URL Configuration** y añade
   `https://crm.tudominio.com` a las Redirect URLs.
10. Vuelve a Meta y apunta el webhook a
    `https://crm.tudominio.com/api/whatsapp/webhook`.
11. Si usas pasos **Wait** en automatizaciones: **Advanced → Cron Jobs**, crea
    un cron cada 5 minutos que llame a
    `https://crm.tudominio.com/api/automations/cron` con la cabecera del
    `AUTOMATION_CRON_SECRET`.

---

## Comandos útiles

```bash
npm run dev        # desarrollo
npm run build      # build de producción
npm start          # servir el build
npm run typecheck  # tsc --noEmit
npm run lint       # eslint
npm test           # vitest
```

## Referencias

- Docs oficiales: <https://wacrm.tech/docs>
- API pública del CRM: `docs/public-api.md`
- Servidor MCP (manejar el CRM desde Claude): `docs/mcp.md`
- Docker (alternativa a Hostinger): `docs/docker.md`
