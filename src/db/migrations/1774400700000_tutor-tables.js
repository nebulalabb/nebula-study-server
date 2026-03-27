/**
 * Migration — Tutor Marketplace: tutor_profiles, tutor_subjects, tutor_availabilities, bookings, booking_reviews
 *
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
export const shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
export const up = (pgm) => {
  pgm.sql(`
    -- ── 9.1 tutor_profiles ───────────────────────────────────────────
    CREATE TABLE tutor_profiles (
        id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id             UUID UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        bio                 TEXT,
        education           TEXT,
        experience_years    INTEGER NOT NULL DEFAULT 0,
        hourly_rate_vnd     INTEGER NOT NULL,
        hourly_rate_min     INTEGER,
        teaching_style      TEXT,
        certifications      JSONB NOT NULL DEFAULT '[]',
        video_intro_url     TEXT,
        rating_avg          NUMERIC(3,2) NOT NULL DEFAULT 0.00,
        review_count        INTEGER NOT NULL DEFAULT 0,
        total_sessions      INTEGER NOT NULL DEFAULT 0,
        is_verified         BOOLEAN NOT NULL DEFAULT FALSE,
        is_available        BOOLEAN NOT NULL DEFAULT TRUE,
        status              TEXT NOT NULL DEFAULT 'pending'
                                CHECK (status IN ('pending', 'approved', 'suspended')),
        deleted_at          TIMESTAMPTZ,
        created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TRIGGER trg_tutor_profiles_updated_at
        BEFORE UPDATE ON tutor_profiles
        FOR EACH ROW EXECUTE FUNCTION set_updated_at();

    -- ── 9.2 tutor_subjects ───────────────────────────────────────────
    CREATE TABLE tutor_subjects (
        id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tutor_id    UUID NOT NULL REFERENCES tutor_profiles(id) ON DELETE CASCADE,
        subject     TEXT NOT NULL,
        grade_levels TEXT[] NOT NULL DEFAULT '{}',
        proficiency TEXT NOT NULL DEFAULT 'advanced'
                        CHECK (proficiency IN ('intermediate', 'advanced', 'expert')),
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (tutor_id, subject)
    );

    -- ── 9.3 tutor_availabilities ─────────────────────────────────────
    CREATE TABLE tutor_availabilities (
        id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tutor_id        UUID NOT NULL REFERENCES tutor_profiles(id) ON DELETE CASCADE,
        day_of_week     INTEGER NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
        start_time      TIME NOT NULL,
        end_time        TIME NOT NULL,
        is_active       BOOLEAN NOT NULL DEFAULT TRUE,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CHECK (end_time > start_time)
    );

    -- ── 9.4 bookings ─────────────────────────────────────────────────
    CREATE TABLE bookings (
        id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        student_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        tutor_id        UUID NOT NULL REFERENCES tutor_profiles(id) ON DELETE CASCADE,
        subject         TEXT NOT NULL,
        grade_level     TEXT,
        session_date    DATE NOT NULL,
        start_time      TIME NOT NULL,
        end_time        TIME NOT NULL,
        duration_minutes INTEGER NOT NULL,
        platform        TEXT NOT NULL DEFAULT 'google_meet'
                            CHECK (platform IN ('google_meet', 'zoom', 'zalo', 'other')),
        meeting_url     TEXT,
        notes           TEXT,

        -- Tài chính
        price_vnd       INTEGER NOT NULL,
        commission_rate NUMERIC(4,2) NOT NULL DEFAULT 0.12,
        commission_vnd  INTEGER NOT NULL,
        tutor_payout_vnd INTEGER NOT NULL,

        -- Trạng thái
        status          TEXT NOT NULL DEFAULT 'pending'
                            CHECK (status IN (
                                'pending',
                                'confirmed',
                                'completed',
                                'cancelled',
                                'no_show'
                            )),
        cancelled_by    UUID REFERENCES users(id),
        cancelled_at    TIMESTAMPTZ,
        cancel_reason   TEXT,
        completed_at    TIMESTAMPTZ,

        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TRIGGER trg_bookings_updated_at
        BEFORE UPDATE ON bookings
        FOR EACH ROW EXECUTE FUNCTION set_updated_at();

    -- ── 9.5 booking_reviews ──────────────────────────────────────────
    CREATE TABLE booking_reviews (
        id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        booking_id      UUID UNIQUE NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
        reviewer_id     UUID NOT NULL REFERENCES users(id),
        tutor_id        UUID NOT NULL REFERENCES tutor_profiles(id),
        rating          INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
        comment         TEXT,
        is_public       BOOLEAN NOT NULL DEFAULT TRUE,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
export const down = (pgm) => {
  pgm.sql(`
    DROP TABLE IF EXISTS booking_reviews;
    DROP TABLE IF EXISTS bookings;
    DROP TABLE IF EXISTS tutor_availabilities;
    DROP TABLE IF EXISTS tutor_subjects;
    DROP TABLE IF EXISTS tutor_profiles;
  `);
};
