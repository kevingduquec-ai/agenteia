-- Prefiero IA — usuarios de panel gestionados por el owner
--
-- Pedido del usuario: un solo rol "owner" (sigue siendo el bootstrap fijo
-- via env, como antes) que puede crear cuentas "admin" y "soporte" desde
-- el panel — ya no son fijas por variable de entorno. El limite de cupos
-- (MAX_ADMIN_SEATS/MAX_SUPPORT_SEATS) se aplica contando filas de esta
-- tabla por rol, no aqui en el esquema.
CREATE TABLE admin_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  role text NOT NULL CHECK (role IN ('admin', 'soporte')),
  created_by text NOT NULL DEFAULT 'owner',
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX idx_admin_users_role ON admin_users (role);
