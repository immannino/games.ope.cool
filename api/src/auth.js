// Accounts for every game on games.ope.cool, via Better Auth stored in Turso.
//
// The games are static pages on a different site than this API, so sessions travel as bearer tokens
// (Authorization header) rather than cookies:
//   - email: a 6-digit code (email OTP). The game sends the code and gets a token back directly.
//   - Google / Discord: the oauth-popup plugin runs OAuth in a popup on this API's own domain and
//     posts the session token back to the game window.
// Providers only switch on once their credentials are set, so the API runs fine with just email.

import { betterAuth } from 'better-auth';
import { bearer, emailOTP, oauthPopup } from 'better-auth/plugins';
import { LibsqlDialect } from '@libsql/kysely-libsql';
import { sendLoginCode } from './email.js';

// sites allowed to use the API: the live arcade plus local dev servers
export function allowedOrigins(env)
{
  const extra = (env.EXTRA_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
  const dev = env.DEV_MODE == 'true' ? ['http://localhost:5173', 'http://localhost:5179', 'http://localhost:4173'] : [];
  return ['https://games.ope.cool', ...dev, ...extra];
}

export function enabledProviders(env)
{
  const providers = ['email'];
  if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) providers.push('google');
  if (env.DISCORD_CLIENT_ID && env.DISCORD_CLIENT_SECRET) providers.push('discord');
  return providers;
}

export function createAuth(env, client)
{
  const socialProviders = {};
  if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET)
    socialProviders.google = { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET };
  if (env.DISCORD_CLIENT_ID && env.DISCORD_CLIENT_SECRET)
    socialProviders.discord = { clientId: env.DISCORD_CLIENT_ID, clientSecret: env.DISCORD_CLIENT_SECRET };

  return betterAuth({
    appName: 'ope.cool arcade',
    baseURL: env.BETTER_AUTH_URL,
    basePath: '/api/auth',
    secret: env.BETTER_AUTH_SECRET,
    database: { dialect: new LibsqlDialect({ client }), type: 'sqlite' },
    trustedOrigins: allowedOrigins(env),
    socialProviders,
    account: {
      // the same verified email signing in with a code, Google or Discord is one player
      accountLinking: { enabled: true, trustedProviders: ['google', 'discord', 'email-otp'] },
    },
    session: { expiresIn: 60*60*24*90, updateAge: 60*60*24 }, // stay signed in for 90 days
    rateLimit: { enabled: true, window: 60, max: 60 },
    // limits are per player IP; Cloudflare passes the real client address in this header
    advanced: { ipAddress: { ipAddressHeaders: ['cf-connecting-ip'] } },
    plugins: [
      bearer(),
      oauthPopup(),
      emailOTP({
        otpLength: 6,
        expiresIn: 10*60,
        allowedAttempts: 5,
        sendVerificationOTP: ({ email, otp }) => sendLoginCode(env, email, otp),
      }),
    ],
  });
}
