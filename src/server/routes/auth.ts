import type { FastifyInstance } from 'fastify'
import { getConfig } from '../config/manager.js'
import {
  clearSessionCookie,
  getSessionToken,
  issueSession,
  readSession,
  revokeSession,
  sanitizeUsername,
  setSessionCookie,
  verifyPassword
} from '../security/webAuth.js'

interface LoginRequestBody {
  username?: string
  password?: string
}

export async function registerAuthRoutes(app: FastifyInstance<any, any, any, any, any>): Promise<void> {
  app.get('/auth/session', async (request) => {
    const config = getConfig()
    const webAuth = config.webAuth
    if (!webAuth?.enabled) {
      return {
        authEnabled: false,
        authenticated: true
      }
    }

    const session = readSession(request)
    if (!session) {
      return {
        authEnabled: true,
        authenticated: false
      }
    }

    return {
      authEnabled: true,
      authenticated: true,
      username: session.username
    }
  })

  app.post('/auth/login', async (request, reply) => {
    const config = getConfig()
    const webAuth = config.webAuth
    if (!webAuth?.enabled) {
      return {
        success: true,
        authEnabled: false
      }
    }

    const body = request.body as LoginRequestBody | undefined
    const username = sanitizeUsername(body?.username)
    const password = typeof body?.password === 'string' ? body.password : undefined

    if (!username || !password) {
      reply.code(400)
      return { error: 'Missing username or password' }
    }

    if (!webAuth.username || username !== webAuth.username || !verifyPassword(password, webAuth)) {
      reply.code(401)
      return { error: 'Invalid credentials' }
    }

    const session = issueSession(username)
    setSessionCookie(reply, session.token)

    return { success: true }
  })

  app.post('/auth/logout', async (request, reply) => {
    const token = getSessionToken(request)
    if (token) {
      revokeSession(token)
    }
    clearSessionCookie(reply)
    return { success: true }
  })
}
