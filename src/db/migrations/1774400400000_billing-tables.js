/**
 * Migration — subscription_plans, subscriptions, payments
 * Theo Database.md mục 11 (Tasks 7.1.1)
 *
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
export const shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
export const up = (pgm) => {
  pgm.sql(`
    -- ── 11.1 subscription_plans ─────────────────────────────────────────────
    CREATE TABLE subscription_plans (
        id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name                TEXT UNIQUE NOT NULL,
        display_name        TEXT NOT NULL,
        price_vnd           INTEGER NOT NULL DEFAULT 0,
        billing_cycle       TEXT CHECK (billing_cycle IN ('monthly', 'yearly', 'lifetime')),
        features            JSONB NOT NULL DEFAULT '{}',
        is_active           BOOLEAN NOT NULL DEFAULT TRUE,
        sort_order          INTEGER NOT NULL DEFAULT 0,
        created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    -- ── 11.2 subscriptions ──────────────────────────────────────────────────
    CREATE TABLE subscriptions (
        id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        plan_id             UUID NOT NULL REFERENCES subscription_plans(id),
        status              TEXT NOT NULL DEFAULT 'active'
                                CHECK (status IN ('active', 'expired', 'cancelled', 'paused')),
        started_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        expires_at          TIMESTAMPTZ,
        cancelled_at        TIMESTAMPTZ,
        auto_renew          BOOLEAN NOT NULL DEFAULT TRUE,
        created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TRIGGER trg_subscriptions_updated_at
        BEFORE UPDATE ON subscriptions
        FOR EACH ROW EXECUTE FUNCTION set_updated_at();

    CREATE INDEX idx_subscriptions_user_status
        ON subscriptions (user_id, status);

    -- ── 11.3 payments ───────────────────────────────────────────────────────
    CREATE TABLE payments (
        id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id             UUID NOT NULL REFERENCES users(id),
        subscription_id     UUID REFERENCES subscriptions(id),
        amount_vnd          INTEGER NOT NULL,
        currency            TEXT NOT NULL DEFAULT 'VND',
        gateway             TEXT NOT NULL CHECK (gateway IN ('vnpay', 'momo', 'stripe', 'manual')),
        gateway_txn_id      TEXT,
        gateway_response    JSONB NOT NULL DEFAULT '{}',
        status              TEXT NOT NULL DEFAULT 'pending'
                                CHECK (status IN ('pending', 'success', 'failed', 'refunded')),
        paid_at             TIMESTAMPTZ,
        refunded_at         TIMESTAMPTZ,
        refund_amount_vnd   INTEGER,
        note                TEXT,
        created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TRIGGER trg_payments_updated_at
        BEFORE UPDATE ON payments
        FOR EACH ROW EXECUTE FUNCTION set_updated_at();

    CREATE INDEX idx_payments_user_id
        ON payments (user_id, created_at DESC);
  `);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
export const down = (pgm) => {
  pgm.sql(`
    DROP INDEX IF EXISTS idx_payments_user_id;
    DROP TABLE IF EXISTS payments;
    DROP INDEX IF EXISTS idx_subscriptions_user_status;
    DROP TABLE IF EXISTS subscriptions;
    DROP TABLE IF EXISTS subscription_plans;
  `);
};
