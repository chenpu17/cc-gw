import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const ORIGINAL_HOME = process.env.HOME
const ORIGINAL_CC_HOME = process.env.CC_GW_HOME

describe('encryption key management', () => {
  let tempHome: string

  beforeEach(() => {
    tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-gw-encryption-test-'))
    process.env.HOME = tempHome
    process.env.CC_GW_HOME = path.join(tempHome, '.cc-gw')
    vi.resetModules()
  })

  afterEach(() => {
    process.env.HOME = ORIGINAL_HOME
    process.env.CC_GW_HOME = ORIGINAL_CC_HOME
    vi.resetModules()
    fs.rmSync(tempHome, { recursive: true, force: true })
  })

  it('regenerates invalid key material and encrypts successfully', async () => {
    const keyDir = path.join(process.env.CC_GW_HOME as string)
    fs.mkdirSync(keyDir, { recursive: true })
    fs.writeFileSync(path.join(keyDir, 'encryption.key'), 'not-a-valid-key', 'utf8')

    const { encryptSecret, decryptSecret } = await import('../../src/server/security/encryption.ts')

    const ciphertext = encryptSecret('secret-value')
    expect(ciphertext).toBeTruthy()
    const decoded = decryptSecret(ciphertext)
    expect(decoded).toBe('secret-value')

    const stored = fs.readFileSync(path.join(keyDir, 'encryption.key'), 'utf8').trim()
    const material = Buffer.from(stored, 'base64')
    expect(material.length).toBe(32)
  })
})
