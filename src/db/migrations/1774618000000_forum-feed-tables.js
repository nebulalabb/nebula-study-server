/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
export const up = (pgm) => {
  pgm.sql(`
    -- ── 16.1 forum_categories ──────────────────────────────────────
    CREATE TABLE forum_categories (
        id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name            TEXT NOT NULL,
        slug            TEXT NOT NULL UNIQUE,
        description     TEXT,
        icon_url        TEXT,
        parent_id       UUID REFERENCES forum_categories(id) ON DELETE SET NULL,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    -- ── 16.2 forum_topics ──────────────────────────────────────────
    CREATE TABLE forum_topics (
        id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        category_id     UUID NOT NULL REFERENCES forum_categories(id) ON DELETE CASCADE,
        author_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        title           TEXT NOT NULL,
        slug            TEXT NOT NULL UNIQUE,
        content         TEXT NOT NULL,
        views           INTEGER NOT NULL DEFAULT 0,
        is_pinned       BOOLEAN NOT NULL DEFAULT FALSE,
        is_locked       BOOLEAN NOT NULL DEFAULT FALSE,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    -- ── 16.3 forum_posts (comments/replies) ─────────────────────────
    CREATE TABLE forum_posts (
        id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        topic_id        UUID NOT NULL REFERENCES forum_topics(id) ON DELETE CASCADE,
        author_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        parent_id       UUID REFERENCES forum_posts(id) ON DELETE CASCADE,
        content         TEXT NOT NULL,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    -- ── 16.4 forum_votes ────────────────────────────────────────────
    CREATE TABLE forum_votes (
        id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        topic_id        UUID REFERENCES forum_topics(id) ON DELETE CASCADE,
        post_id         UUID REFERENCES forum_posts(id) ON DELETE CASCADE,
        vote_type       INTEGER NOT NULL DEFAULT 1, -- 1 for up, -1 for down
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (user_id, topic_id),
        UNIQUE (user_id, post_id),
        CHECK (
            (topic_id IS NOT NULL AND post_id IS NULL) OR
            (topic_id IS NULL AND post_id IS NOT NULL)
        )
    );

    -- ── 16.5 feed_posts ─────────────────────────────────────────────
    CREATE TABLE feed_posts (
        id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        author_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        content         TEXT,
        media_urls      JSONB DEFAULT '[]',
        privacy         TEXT NOT NULL DEFAULT 'public' CHECK (privacy IN ('public', 'friends', 'private')),
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    -- ── 16.6 feed_likes ─────────────────────────────────────────────
    CREATE TABLE feed_likes (
        id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        post_id         UUID NOT NULL REFERENCES feed_posts(id) ON DELETE CASCADE,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (user_id, post_id)
    );

    -- ── 16.7 feed_comments ──────────────────────────────────────────
    CREATE TABLE feed_comments (
        id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        post_id         UUID NOT NULL REFERENCES feed_posts(id) ON DELETE CASCADE,
        author_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        content         TEXT NOT NULL,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    -- ── TRIGGERS ──
    CREATE TRIGGER trg_forum_topics_updated_at BEFORE UPDATE ON forum_topics FOR EACH ROW EXECUTE FUNCTION set_updated_at();
    CREATE TRIGGER trg_forum_posts_updated_at BEFORE UPDATE ON forum_posts FOR EACH ROW EXECUTE FUNCTION set_updated_at();
    CREATE TRIGGER trg_feed_posts_updated_at BEFORE UPDATE ON feed_posts FOR EACH ROW EXECUTE FUNCTION set_updated_at();

    -- ── SEEDS ──
    INSERT INTO forum_categories (name, slug, description) VALUES 
    ('Hỏi Đáp Bài Tập', 'hoi-dap-bai-tap', 'Nơi bạn đặt câu hỏi về các bài tập khó nhằn.'),
    ('Thảo Luận Chung', 'thao-luan-chung', 'Trao đổi về học tập, định hướng nghề nghiệp.'),
    ('Mẹo & Tài Liệu', 'meo-tai-lieu', 'Chia sẻ tài liệu học tập và các phương pháp học hiệu quả.');
  `);
};

export const down = (pgm) => {
  pgm.sql(`
    DROP TABLE IF EXISTS feed_comments;
    DROP TABLE IF EXISTS feed_likes;
    DROP TABLE IF EXISTS feed_posts;
    DROP TABLE IF EXISTS forum_votes;
    DROP TABLE IF EXISTS forum_posts;
    DROP TABLE IF EXISTS forum_topics;
    DROP TABLE IF EXISTS forum_categories;
  `);
};
