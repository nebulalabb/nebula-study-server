/**
 * Seed data — subscription_plans (Free + Premium)
 * Theo API_Spec.md mục 12.1 (Task 7.1.2)
 *
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
export const shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
export const up = (pgm) => {
  pgm.sql(`
    INSERT INTO subscription_plans (name, display_name, price_vnd, billing_cycle, features, sort_order) 
    VALUES
    ('free', 'Miễn phí', 0, NULL, '{
        "flashcard_limit": 20,
        "solver_daily_limit": 5,
        "summary_daily_limit": 3,
        "quiz_daily_limit": 1,
        "ai_model": "gemini-1.5-flash",
        "storage_mb": 100
    }', 1),
    ('premium_monthly', 'Premium Tháng', 99000, 'monthly', '{
        "flashcard_limit": -1,
        "solver_daily_limit": -1,
        "summary_daily_limit": -1,
        "quiz_daily_limit": -1,
        "ai_model": "gemini-1.5-pro",
        "storage_mb": 5000
    }', 2),
    ('premium_yearly', 'Premium Năm', 799000, 'yearly', '{
        "flashcard_limit": -1,
        "solver_daily_limit": -1,
        "summary_daily_limit": -1,
        "quiz_daily_limit": -1,
        "ai_model": "gemini-1.5-pro",
        "storage_mb": 10000
    }', 3)
    ON CONFLICT (name) DO NOTHING;
  `);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
export const down = (pgm) => {
  pgm.sql(`
    DELETE FROM subscription_plans WHERE name IN ('free', 'premium_monthly', 'premium_yearly');
  `);
};
