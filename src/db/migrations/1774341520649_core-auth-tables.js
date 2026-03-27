/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
export const shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
export const up = (pgm) => {
  pgm.sql(`
    CREATE TABLE users (
        id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        email               TEXT UNIQUE NOT NULL,
        email_verified      BOOLEAN NOT NULL DEFAULT FALSE,
        password_hash       TEXT,
        full_name           TEXT NOT NULL,
        avatar_url          TEXT,
        role                TEXT NOT NULL DEFAULT 'student'
                                CHECK (role IN ('student', 'tutor', 'admin')),
        plan                TEXT NOT NULL DEFAULT 'free'
                                CHECK (plan IN ('free', 'premium', 'enterprise')),
        plan_expires_at     TIMESTAMPTZ,
        locale              TEXT NOT NULL DEFAULT 'vi',
        timezone            TEXT NOT NULL DEFAULT 'Asia/Ho_Chi_Minh',
        metadata            JSONB NOT NULL DEFAULT '{}',
        deleted_at          TIMESTAMPTZ,
        created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TRIGGER trg_users_updated_at
        BEFORE UPDATE ON users
        FOR EACH ROW EXECUTE FUNCTION set_updated_at();

    CREATE TABLE user_oauth_accounts (
        id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        provider        TEXT NOT NULL CHECK (provider IN ('google', 'facebook', 'github')),
        provider_uid    TEXT NOT NULL,
        access_token    TEXT,
        refresh_token   TEXT,
        token_expires_at TIMESTAMPTZ,
        raw_profile     JSONB NOT NULL DEFAULT '{}',
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (provider, provider_uid)
    );

    CREATE TRIGGER trg_user_oauth_accounts_updated_at
        BEFORE UPDATE ON user_oauth_accounts
        FOR EACH ROW EXECUTE FUNCTION set_updated_at();

    CREATE TABLE user_sessions (
        id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        refresh_token   TEXT UNIQUE NOT NULL,
        ip_address      INET,
        user_agent      TEXT,
        last_active_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        expires_at      TIMESTAMPTZ NOT NULL,
        revoked_at      TIMESTAMPTZ,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE email_verifications (
        id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token       TEXT UNIQUE NOT NULL,
        type        TEXT NOT NULL CHECK (type IN ('verify_email', 'reset_password')),
        expires_at  TIMESTAMPTZ NOT NULL,
        used_at     TIMESTAMPTZ,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE usage_logs (
        id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        module      TEXT NOT NULL CHECK (module IN (
                        'flashcard', 'solver', 'exam',
                        'microlearn', 'note', 'quiz'
                    )),
        action      TEXT NOT NULL,
        tokens_used INTEGER NOT NULL DEFAULT 0,
        metadata    JSONB NOT NULL DEFAULT '{}',
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
export const down = (pgm) => {
  pgm.sql(`
    DROP TABLE IF EXISTS usage_logs;
    DROP TABLE IF EXISTS email_verifications;
    DROP TABLE IF EXISTS user_sessions;
    DROP TABLE IF EXISTS user_oauth_accounts;
    DROP TABLE IF EXISTS users;
  `);
};
