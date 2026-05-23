import { Response } from 'express';
import { z } from 'zod';

export function handleAuthError(res: Response, error: unknown): boolean {
  if (error instanceof Error && (error.message === 'No token provided' || error.message === 'Invalid token' || error.message === 'Token expired')) {
    res.status(401).json({ success: false, error: error.message });
    return true;
  }
  return false;
}

export function handleZodError(res: Response, error: unknown): boolean {
  if (error instanceof z.ZodError) {
    res.status(400).json({ success: false, error: error.errors[0].message });
    return true;
  }
  return false;
}
