import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import jwt from 'jsonwebtoken';
import type { FastifyReply, FastifyRequest } from 'fastify';

const JWT_SECRET = process.env.ENLAZA_JWT_SECRET ?? 'dev-secret-change-me';
const TOKEN_TTL = '7d';

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 32);
  return `${salt.toString('hex')}:${hash.toString('hex')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [saltHex, hashHex] = stored.split(':');
  if (!saltHex || !hashHex) return false;
  const hash = scryptSync(password, Buffer.from(saltHex, 'hex'), 32);
  return timingSafeEqual(hash, Buffer.from(hashHex, 'hex'));
}

export interface TokenPayload {
  sub: string;
  name: string;
}

export function signToken(userId: string, displayName: string): string {
  return jwt.sign({ sub: userId, name: displayName }, JWT_SECRET, { expiresIn: TOKEN_TTL });
}

export function verifyToken(token: string): TokenPayload | null {
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (typeof decoded === 'string' || typeof decoded.sub !== 'string') return null;
    return { sub: decoded.sub, name: String(decoded.name ?? '') };
  } catch {
    return null;
  }
}

declare module 'fastify' {
  interface FastifyRequest {
    user: TokenPayload | null;
  }
}

/** Parse the Authorization header if present; never rejects. */
export function parseAuth(request: FastifyRequest): void {
  request.user = null;
  const header = request.headers.authorization;
  if (header?.startsWith('Bearer ')) {
    request.user = verifyToken(header.slice('Bearer '.length));
  }
}

/** preHandler for routes that require a logged-in user. */
export async function requireAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!request.user) {
    await reply.code(401).send({ error: 'No autenticado' });
  }
}
