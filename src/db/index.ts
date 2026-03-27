import { Pool, QueryResult, QueryResultRow } from 'pg';
import * as dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables from the current working directory's .env
dotenv.config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle client', err);
  process.exit(-1);
});

export const db = {
  /**
   * Execute a SQL query
   */
  query: async <T extends QueryResultRow = any>(text: string, params?: any[]): Promise<QueryResult<T>> => {
    const start = Date.now();
    const res = await pool.query<T>(text, params);
    const duration = Date.now() - start;
    if (process.env.NODE_ENV !== 'production') {
      console.log('Executed query', { text, duration, rows: res.rowCount });
    }
    return res;
  },

  /**
   * Execute a query and return the first row
   */
  queryOne: async <T extends QueryResultRow = any>(text: string, params?: any[]): Promise<T | null> => {
    const res = await pool.query<T>(text, params);
    return res.rows[0] || null;
  },

  /**
   * Get a client from the pool for transactions
   */
  getClient: () => pool.connect(),

  /**
   * Close the pool
   */
  close: () => pool.end(),
};
