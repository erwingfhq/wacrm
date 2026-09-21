#!/usr/bin/env bash
# Publica el CRM y Supabase con Tailscale.
#
#   :443  → app (Next.js en 127.0.0.1:3000)   PÚBLICO vía Funnel
#   :8443 → Supabase API (Kong en 127.0.0.1:8000)  solo tailnet
#
# Por qué la app es pública y Supabase no: Meta tiene que llegar al
# webhook (/api/whatsapp/webhook) desde internet, y Funnel expone el
# puerto entero, no una ruta. Pero iniciar sesión requiere hablar con
# Supabase, que SOLO es alcanzable dentro de la tailnet. Un desconocido
# ve la pantalla de login y no puede pasar de ahí; el equipo, con
# Tailscale en su dispositivo, entra con normalidad.
#
# Requisitos previos, una sola vez, en https://login.tailscale.com/admin:
#   - DNS → HTTPS Certificates: activado
#   - Access controls: nodeAttrs con "funnel" para este nodo (o tag)
#
# Uso: sudo ./tailscale-serve.sh
set -euo pipefail

tailscale serve --bg --https=443  http://127.0.0.1:3000
tailscale serve --bg --https=8443 http://127.0.0.1:8000
tailscale funnel --bg --https=443 on

echo
tailscale serve status
echo
echo "Webhook para Meta:  https://$(tailscale status --json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).Self.DNSName.replace(/\.$/,"")))')/api/whatsapp/webhook"
