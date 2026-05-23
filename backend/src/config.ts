import { z } from 'zod';

const envSchema = z.object({
  PORT: z.string().default('3001'),
  DATABASE_URL: z.string(),
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  DEFAULT_FOCUS_MINUTES: z.string().default('25'),
  DEFAULT_SHORT_BREAK_MINUTES: z.string().default('5'),
  DEFAULT_LONG_BREAK_MINUTES: z.string().default('15'),
  EXPO_PROJECT_ID: z.string().default('YOUR_EXPO_PROJECT_ID'),
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
