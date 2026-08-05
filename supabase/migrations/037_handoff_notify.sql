-- Aviso del traspaso fuera de la app.
--
-- Cuando el agente traspasa un hilo a un humano, hoy solo se crea una
-- fila en `notifications` — la campanita del CRM. Si nadie tiene la
-- pestaña abierta, el cliente se queda esperando sin que nadie lo sepa.
-- Estas columnas permiten mandar además un WhatsApp al responsable.
--
-- Por qué en `ai_configs` y no en `whatsapp_config`: esto es política
-- del agente, no configuración del canal. Va donde ya viven
-- `handoff_agent_id` y el prompt.

ALTER TABLE ai_configs
  ADD COLUMN IF NOT EXISTS handoff_notify_phone text;

-- Nombre de la plantilla aprobada en Meta que se usa cuando la ventana
-- de 24 h está cerrada. NULL = solo se intenta el texto libre, que
-- fallará si hace más de un día que el responsable no escribe al número
-- del negocio. La plantilla debe tener exactamente dos variables:
--   {{1}} nombre del cliente, {{2}} su última consulta.
ALTER TABLE ai_configs
  ADD COLUMN IF NOT EXISTS handoff_notify_template text;

-- Código de idioma de esa plantilla ('es', 'en_US', …). Meta trata cada
-- idioma como una plantilla distinta, así que el nombre por sí solo no
-- basta para enviarla.
ALTER TABLE ai_configs
  ADD COLUMN IF NOT EXISTS handoff_notify_template_lang text NOT NULL DEFAULT 'es';

COMMENT ON COLUMN ai_configs.handoff_notify_phone IS
  'Teléfono en formato internacional sin "+" que recibe el aviso de traspaso por WhatsApp. NULL = sin aviso externo.';
COMMENT ON COLUMN ai_configs.handoff_notify_template IS
  'Plantilla aprobada en Meta para avisar fuera de la ventana de 24 h. Dos variables: {{1}} cliente, {{2}} consulta.';
