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
    CREATE INDEX idx_users_email ON users(email);
    CREATE INDEX idx_user_oauth_accounts_user_id ON user_oauth_accounts(user_id);
    CREATE INDEX idx_user_sessions_user_id ON user_sessions(user_id);
    CREATE INDEX idx_user_sessions_refresh_token ON user_sessions(refresh_token);
    CREATE INDEX idx_email_verifications_user_id ON email_verifications(user_id);
    CREATE INDEX idx_email_verifications_token ON email_verifications(token);
    CREATE INDEX idx_usage_logs_user_id ON usage_logs(user_id);
    CREATE INDEX idx_usage_logs_created_at ON usage_logs(created_at);
  `);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
export const down = (pgm) => {
  pgm.sql(`
    DROP INDEX IF EXISTS idx_usage_logs_created_at;
    DROP INDEX IF EXISTS idx_usage_logs_user_id;
    DROP INDEX IF EXISTS idx_email_verifications_token;
    DROP INDEX IF EXISTS idx_email_verifications_user_id;
    DROP INDEX IF EXISTS idx_user_sessions_refresh_token;
    DROP INDEX IF EXISTS idx_user_sessions_user_id;
    DROP INDEX IF EXISTS idx_user_oauth_accounts_user_id;
    DROP INDEX IF EXISTS idx_users_email;
  `);
};
