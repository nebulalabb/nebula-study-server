/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
export const up = (pgm) => {
  pgm.sql(`
    -- ── 15.1 friendships ───────────────────────────────────────────
    CREATE TABLE friendships (
        id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        requester_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        addressee_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        status          TEXT NOT NULL DEFAULT 'pending'
                            CHECK (status IN ('pending', 'accepted', 'declined', 'blocked')),
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (requester_id, addressee_id),
        CHECK (requester_id <> addressee_id)
    );

    CREATE TRIGGER trg_friendships_updated_at
        BEFORE UPDATE ON friendships
        FOR EACH ROW EXECUTE FUNCTION set_updated_at();

    -- ── 15.2 messages ──────────────────────────────────────────────
    CREATE TABLE messages (
        id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        sender_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        recipient_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        content         TEXT NOT NULL,
        is_read         BOOLEAN NOT NULL DEFAULT FALSE,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX idx_messages_conversation 
        ON messages (sender_id, recipient_id, created_at DESC);
  `);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
export const down = (pgm) => {
  pgm.sql(`
    DROP TABLE IF EXISTS messages;
    DROP TABLE IF EXISTS friendships;
  `);
};
