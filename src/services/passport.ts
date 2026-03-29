import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import { UserService } from './user.service.js';
import { db } from '../db/index.js';
import * as dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '../../../.env') });

passport.use(
  new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID || 'google-id',
      clientSecret: process.env.GOOGLE_CLIENT_SECRET || 'google-secret',
      callbackURL: '/v1/auth/google/callback',
      scope: ['profile', 'email'],
    },
    async (accessToken, refreshToken, profile, done) => {
      try {
        const email = profile.emails?.[0]?.value ?? null;
        console.log('[Passport] Profile:', JSON.stringify(profile, null, 2));
        if (!email) {
          console.error('[Passport] No email found');
          return done(new Error('No email found in Google profile'), false);
        }

        // 1. Find or create user
        let user = await UserService.findByEmail(email);

        const client = await db.getClient();
        try {
          await client.query('BEGIN');
          
          if (!user) {
            // Create user
            const res = await client.query(
              'INSERT INTO users (email, full_name, role, plan, email_verified) VALUES ($1, $2, $3, $4, true) RETURNING *',
              [email, profile.displayName, 'student', 'free']
            );
            user = res.rows[0];
          }

          // 2. Link OAuth account (upsert)
          await client.query(
            `INSERT INTO user_oauth_accounts (user_id, provider, provider_uid, raw_profile)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (provider, provider_uid) DO UPDATE SET 
             raw_profile = EXCLUDED.raw_profile`,
            [user!.id, 'google', profile.id, JSON.stringify(profile)]
          );

          await client.query('COMMIT');
          return done(null, user || undefined);
        } catch (err) {
          await client.query('ROLLBACK');
          throw err;
        } finally {
          client.release();
        }
      } catch (err: any) {
        return done(err, false);
      }
    }
  )
);

// We use stateless JWTs, but passport still needs these if using session: false
passport.serializeUser((user: any, done) => {
  done(null, user.id);
});

passport.deserializeUser(async (id: string, done) => {
  try {
    const user = await db.queryOne('SELECT * FROM users WHERE id = $1', [id]);
    done(null, user || undefined);
  } catch (err) {
    done(err, null);
  }
});

export default passport;
