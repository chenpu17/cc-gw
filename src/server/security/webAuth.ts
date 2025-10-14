import type { FastifyReply, FastifyRequest } from 'fastify'
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'

const SESSION_COOKIE_NAME = 'ccgw_session'
const SESSION_TTL_MS = 1000 * 60 * 60 * 12 // 12 hours

interface SessionRecord {
  token: string
  username: string
  expiresAt: number
}

const sessions = new Map<string, SessionRecord>()

function derive(password: string, salt: string): Buffer {
  return scryptSync(password, salt, 64)
}

export function createPasswordRecord(password: string): { passwordHash: string; passwordSalt: string } {
  const salt = randomBytes(16).toString('hex')
  const hash = derive(password, salt).toString('base64')
  return {
    passwordHash: hash,
    passwordSalt: salt
  }
}

export function verifyPassword(
  password: string,
  record: { passwordHash?: string; passwordSalt?: string } | undefined | null
): boolean {
  if (!record?.passwordHash || !record?.passwordSalt) return false
  try {
    const expected = Buffer.from(record.passwordHash, 'base64')
    const actual = derive(password, record.passwordSalt)
    if (expected.length !== actual.length) return false
    return timingSafeEqual(expected, actual)
  } catch {
    return false
  }
}

function purgeExpiredSessions(): void {
  const now = Date.now()
  for (const [token, session] of sessions.entries()) {
    if (session.expiresAt <= now) {
      sessions.delete(token)
    }
  }
}

function buildCookieString(token: string, ttlMs: number): string {
  const expires = new Date(Date.now() + ttlMs)
  const parts = [
    `${SESSION_COOKIE_NAME}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    `Max-Age=${Math.floor(ttlMs / 1000)}`,
    `Expires=${expires.toUTCString()}`
  ]
  return parts.join('; ')
}

function parseCookie(header: string | undefined): Record<string, string> {
  if (!header) return {}
  const entries = header.split(';').map((part) => part.trim())
  const result: Record<string, string> = {}
  for (const entry of entries) {
    const [key, ...rest] = entry.split('=')
    if (!key) continue
    result[key] = rest.join('=')
  }
  return result
}

function getSessionByToken(token: string | null | undefined): SessionRecord | null {
  if (!token) return null
  purgeExpiredSessions()
  const session = sessions.get(token)
  if (!session) return null
  if (session.expiresAt <= Date.now()) {
    sessions.delete(token)
    return null
  }
  session.expiresAt = Date.now() + SESSION_TTL_MS
  sessions.set(token, session)
  return session
}

export function readSession(request: FastifyRequest): SessionRecord | null {
  const cookieHeader = request.headers.cookie
  const cookies = parseCookie(typeof cookieHeader === 'string' ? cookieHeader : undefined)
  const token = cookies[SESSION_COOKIE_NAME] ?? null
  return getSessionByToken(token)
}

export function issueSession(username: string): SessionRecord {
  purgeExpiredSessions()
  const token = randomBytes(32).toString('base64url')
  const record: SessionRecord = {
    token,
    username,
    expiresAt: Date.now() + SESSION_TTL_MS
  }
  sessions.set(token, record)
  return record
}

export function setSessionCookie(reply: FastifyReply, token: string): void {
  reply.header('Set-Cookie', buildCookieString(token, SESSION_TTL_MS))
}

export function clearSessionCookie(reply: FastifyReply): void {
  reply.header('Set-Cookie', `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0; Expires=${new Date(0).toUTCString()}`)
}

export function revokeSession(token: string | null | undefined): void {
  if (!token) return
  sessions.delete(token)
}

export function revokeAllSessions(): void {
  sessions.clear()
}

export function getSessionToken(request: FastifyRequest): string | null {
  const cookieHeader = request.headers.cookie
  const cookies = parseCookie(typeof cookieHeader === 'string' ? cookieHeader : undefined)
  return cookies[SESSION_COOKIE_NAME] ?? null
}

export function sanitizeUsername(username: string | undefined): string | undefined {
  if (typeof username !== 'string') return undefined
  const trimmed = username.trim()
  return trimmed || undefined
}

export { SESSION_COOKIE_NAME, SESSION_TTL_MS }
