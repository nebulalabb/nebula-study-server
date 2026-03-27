/**
 * Migration — audit_logs (Phase 12.1.1)
 */
export const shorthands = undefined;

export const up = (pgm) => {
  pgm.sql(`
    CREATE TABLE audit_logs (
        id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        actor_id    UUID REFERENCES users(id) ON DELETE SET NULL,
        action      TEXT NOT NULL,
        entity_type TEXT,
        entity_id   UUID,
        old_data    JSONB,
        new_data    JSONB,
        ip_address  INET,
        user_agent  TEXT,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX idx_audit_logs_actor_id ON audit_logs(actor_id);
    CREATE INDEX idx_audit_logs_action ON audit_logs(action);
    CREATE INDEX idx_audit_logs_created_at ON audit_logs(created_at DESC);
  `);
};

export const down = (pgm) => {
  pgm.sql(`DROP TABLE IF EXISTS audit_logs;`);
};
