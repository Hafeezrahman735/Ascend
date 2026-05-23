import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config';

declare global {
  namespace Express {
    interface Request {
      userId: string;
    }
  }
}

export interface JwtPayload {
  userId: string;
  username: string;
  iat?: number;
  exp?: number;
}

export function verifyAccessToken(token: string): JwtPayload {
  try {
    return jwt.verify(token, config.JWT_ACCESS_SECRET) as JwtPayload;
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      throw new Error('Token expired');
    }
    throw new Error('Invalid token');
  }
}

export function signAccessToken(payload: { userId: string; username: string }): string {
  return jwt.sign(payload, config.JWT_ACCESS_SECRET, { expiresIn: '15m' });
}

export function signRefreshToken(payload: { userId: string; username: string }): string {
  return jwt.sign(payload, config.JWT_REFRESH_SECRET, { expiresIn: '7d' });
}

export function verifyRefreshToken(token: string): JwtPayload {
  try {
    return jwt.verify(token, config.JWT_REFRESH_SECRET) as JwtPayload;
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      throw new Error('Refresh token expired');
    }
    throw new Error('Invalid refresh token');
  }
}

export function authenticate(req: Request): string {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new Error('No token provided');
  }
  const token = authHeader.split(' ')[1];
  const payload = verifyAccessToken(token);
  return payload.userId;
}

export function authenticateMiddleware(req: Request, res: Response, next: NextFunction): void {
  try {
    const userId = authenticate(req);
    req.userId = userId;
    next();
  } catch (error) {
    if (error instanceof Error && (error.message === 'No token provided' || error.message === 'Invalid token' || error.message === 'Token expired')) {
      res.status(401).json({ success: false, error: error.message });
      return;
    }
    res.status(401).json({ success: false, error: 'Invalid token' });
  }
}
