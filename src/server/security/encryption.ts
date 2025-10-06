import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto'

const HOME_OVERRIDE = process.env.CC_GW_HOME
const HOME_DIR = path.resolve(HOME_OVERRIDE ?? path.join(os.homedir(), '.cc-gw'))
const KEY_PATH = path.join(HOME_DIR, 'encryption.key')
const KEY_LENGTH = 32
const KEY_FILE_MODE = 0o600

let cachedKey: Buffer | null = null

function writeKeyFile(buffer: Buffer): void {
  fs.mkdirSync(HOME_DIR, { recursive: true })
  fs.writeFileSync(KEY_PATH, buffer.toString('base64'), { encoding: 'utf8', mode: KEY_FILE_MODE })
}

function decodeKeyContent(content: string): Buffer | null {
  const trimmed = content.trim()
  if (!trimmed) {
    return null
  }

  const tryBase64 = (() => {
    try {
      const decoded = Buffer.from(trimmed, 'base64')
      return decoded.length === KEY_LENGTH ? decoded : null
    } catch {
      return null
    }
  })()
  if (tryBase64) return tryBase64

  if (/^[0-9a-fA-F]+$/.test(trimmed) && trimmed.length === KEY_LENGTH * 2) {
    const decoded = Buffer.from(trimmed, 'hex')
    if (decoded.length === KEY_LENGTH) {
      return decoded
    }
  }

  if (trimmed.length === KEY_LENGTH) {
    const ascii = Buffer.from(trimmed, 'utf8')
    if (ascii.length === KEY_LENGTH) {
      return ascii
    }
  }

  return null
}

function ensureKeyMaterial(): Buffer {
  if (cachedKey) {
    return cachedKey
  }

  fs.mkdirSync(HOME_DIR, { recursive: true })

  if (!fs.existsSync(KEY_PATH)) {
    const generated = randomBytes(KEY_LENGTH)
    writeKeyFile(generated)
    cachedKey = generated
    return generated
  }

  const content = fs.readFileSync(KEY_PATH, 'utf8')
  const decoded = decodeKeyContent(content)

  if (decoded) {
    cachedKey = decoded
    return decoded
  }

  const regenerated = randomBytes(KEY_LENGTH)
  writeKeyFile(regenerated)
  cachedKey = regenerated
  console.info('[cc-gw][encryption] regenerated encryption key due to invalid file format')
  return regenerated
}

export function getEncryptionKey(): Buffer {
  return ensureKeyMaterial()
}

export function encryptSecret(value: string | null | undefined): string | null {
  if (value === null || value === undefined) {
    return null
  }
  const key = ensureKeyMaterial()
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([iv, tag, encrypted]).toString('base64')
}

export function decryptSecret(payload: string | null | undefined): string | null {
  if (!payload) {
    return null
  }
  try {
    const buffer = Buffer.from(payload, 'base64')
    if (buffer.length <= 28) {
      return null
    }
    const iv = buffer.subarray(0, 12)
    const tag = buffer.subarray(12, 28)
    const ciphertext = buffer.subarray(28)
    const decipher = createDecipheriv('aes-256-gcm', ensureKeyMaterial(), iv)
    decipher.setAuthTag(tag)
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()])
    return decrypted.toString('utf8')
  } catch (error) {
    console.warn('[cc-gw][encryption] failed to decrypt payload', error)
    return null
  }
}
