-- Prefiero IA — soporte humano (sección 41-46: escalar a un agente real)
--
-- Pedido del usuario: cuando un cliente pide hablar con soporte, la IA
-- debe pedirle que escriba que necesita y dejar de responder ella misma —
-- un agente humano (rol "soporte" en el panel admin, separado del rol
-- "admin" que ve dashboards) atiende desde ahi. Al resolver/cerrar/
-- cancelar, el chat del cliente debe reiniciar solo.
--
-- `status` vive en la conversacion (no en cada mensaje) porque la
-- decision de "esto ya lo tiene un humano" aplica a toda la conversacion
-- de una vez, no mensaje por mensaje.
ALTER TABLE conversations
  ADD COLUMN status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'needs_support', 'resolved', 'closed', 'cancelled'));

CREATE INDEX idx_conversations_status ON conversations (status) WHERE status = 'needs_support';

-- Los mensajes de un agente humano necesitan su propio rol — reusar
-- "assistant" mezclaria las respuestas de la IA con las de una persona
-- real en la misma columna, sin forma de distinguirlas despues.
ALTER TABLE messages DROP CONSTRAINT messages_role_check;
ALTER TABLE messages
  ADD CONSTRAINT messages_role_check
    CHECK (role = ANY (ARRAY['user'::text, 'assistant'::text, 'system'::text, 'tool'::text, 'support_agent'::text]));
