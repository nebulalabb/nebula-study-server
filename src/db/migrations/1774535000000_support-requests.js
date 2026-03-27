
export const up = (pgm) => {
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS support_requests (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      category TEXT NOT NULL,
      message TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' 
             CHECK (status IN ('pending', 'in_progress', 'resolved', 'closed')),
      admin_notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TRIGGER trg_support_requests_updated_at
      BEFORE UPDATE ON support_requests
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();

    CREATE INDEX IF NOT EXISTS idx_support_requests_status ON support_requests(status);
    CREATE INDEX IF NOT EXISTS idx_support_requests_user ON support_requests(user_id);
  `);
};

export const down = (pgm) => {
  pgm.sql(`
    DROP TABLE IF EXISTS support_requests;
  `);
};
