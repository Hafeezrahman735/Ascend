import { z } from 'zod';

// Reject the shipped placeholder secrets so the server can never boot with them.
const isRealSecret = (v: string) => !/change-me/i.test(v);
const placeholderMsg = 'is still the placeholder — set a real random secret (e.g. `openssl rand -hex 48`)';

const envSchema = z.object({
  PORT: z.string().default('3001'),
  DATABASE_URL: z.string(),
  JWT_ACCESS_SECRET: z.string().min(32).refine(isRealSecret, `JWT_ACCESS_SECRET ${placeholderMsg}`),
  JWT_REFRESH_SECRET: z.string().min(32).refine(isRealSecret, `JWT_REFRESH_SECRET ${placeholderMsg}`),
  DEFAULT_FOCUS_MINUTES: z.string().default('25'),
  DEFAULT_SHORT_BREAK_MINUTES: z.string().default('5'),
  DEFAULT_LONG_BREAK_MINUTES: z.string().default('15'),
  EXPO_PROJECT_ID: z.string().default('YOUR_EXPO_PROJECT_ID'),

  // Google Calendar sync — entirely optional. Left unset, the server boots
  // normally and the calendar works on local data only; the connect endpoint
  // reports 503 rather than failing at startup.
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GOOGLE_REDIRECT_URI: z.string().url().optional(),
  // Deep-link scheme the OAuth callback bounces back into. Matches `scheme` in
  // mobile/app.json.
  APP_DEEP_LINK_SCHEME: z.string().default('ascend'),

  // Encrypts third-party OAuth tokens at rest (see lib/secretBox.ts). Optional
  // so an existing deploy does not fail to boot the moment this ships; unset,
  // tokens are stored as they always were. Generate with:
  //   openssl rand -hex 32
  TOKEN_ENCRYPTION_KEY: z.string()
    .regex(/^[0-9a-fA-F]{64}$/, 'TOKEN_ENCRYPTION_KEY must be 64 hex characters (openssl rand -hex 32)')
    .optional(),
});

function loadConfig() {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    console.error('Invalid environment configuration:', result.error.format());
    process.exit(1);
  }
  return result.data;
}

export const config = loadConfig();

export const TIMER_DEFAULTS = {
  FOCUS_MINUTES: parseInt(config.DEFAULT_FOCUS_MINUTES, 10),
  SHORT_BREAK_MINUTES: parseInt(config.DEFAULT_SHORT_BREAK_MINUTES, 10),
  LONG_BREAK_MINUTES: parseInt(config.DEFAULT_LONG_BREAK_MINUTES, 10),
  POMODOROS_BEFORE_LONG_BREAK: 4,
};
