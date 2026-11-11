/**
 * The cryptography of sync. Everything here uses the browser's built-in Web Crypto API;
 * there is no crypto library to trust or keep updated.
 *
 * The sync key is 32 random bytes, generated on the first device and typed or pasted into the others.
 * Two things are derived from it (HKDF-SHA-256), and neither can be turned back into the key:
 *   - an encryption key (AES-256-GCM) that never leaves the device, and
 *   - an access token the server uses to recognise your devices.
 * The server therefore never holds anything that can decrypt a record.
 */

const encoder = new TextEncoder()
const decoder = new TextDecoder('utf-8', { fatal: true })

type Bytes = Uint8Array<ArrayBuffer>

/* ---------- The sync key as text ---------- */

/** Crockford base32: no I, L, O or U, so the key survives being read aloud or typed by hand. */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
const KEY_BYTES = 32
const CHECK_BYTES = 2

export class SyncKeyError extends Error {}

function toBase32(bytes: Uint8Array): string {
  let out = ''
  let acc = 0
  let bits = 0
  for (const byte of bytes) {
    acc = (acc << 8) | byte
    bits += 8
    while (bits >= 5) {
      out += ALPHABET[(acc >>> (bits - 5)) & 31]
      bits -= 5
    }
    acc &= (1 << bits) - 1
  }
  if (bits > 0) out += ALPHABET[(acc << (5 - bits)) & 31]
  return out
}

function fromBase32(text: string): Bytes | null {
  const out: number[] = []
  let acc = 0
  let bits = 0
  for (const char of text) {
    const value = ALPHABET.indexOf(char)
    if (value < 0) return null
    acc = (acc << 5) | value
    bits += 5
    if (bits >= 8) {
      out.push((acc >>> (bits - 8)) & 255)
      bits -= 8
    }
    acc &= (1 << bits) - 1
  }
  return acc === 0 ? new Uint8Array(out) : null
}

/** Two bytes that catch typing mistakes before anything is sent anywhere. Not a security feature. */
async function checkBytes(secret: Bytes): Promise<Bytes> {
  const label = encoder.encode('control-room sync key check v1')
  const input = new Uint8Array(label.length + secret.length)
  input.set(label)
  input.set(secret, label.length)
  return new Uint8Array(await crypto.subtle.digest('SHA-256', input)).slice(0, CHECK_BYTES)
}

/** Write 32 secret bytes the way people handle them: 11 groups of 5 characters, check bytes included. */
export async function formatSyncKey(secret: Bytes): Promise<string> {
  const full = new Uint8Array(KEY_BYTES + CHECK_BYTES)
  full.set(secret)
  full.set(await checkBytes(secret), KEY_BYTES)
  return (toBase32(full).match(/.{1,5}/g) ?? []).join('-')
}

/** A fresh sync key from the browser's cryptographic random number generator. */
export function generateSyncKey(): Promise<string> {
  return formatSyncKey(crypto.getRandomValues(new Uint8Array(KEY_BYTES)))
}

/** Read a typed or pasted sync key. Forgiving about case, spaces, dashes and look-alike letters. */
export async function parseSyncKey(text: string): Promise<Bytes> {
  const cleaned = text
    .toUpperCase()
    .replace(/[\s-]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1')
  if (cleaned === '') throw new SyncKeyError('Enter your sync key.')
  const full = fromBase32(cleaned)
  if (!full || full.length !== KEY_BYTES + CHECK_BYTES) {
    throw new SyncKeyError('That does not look like a sync key. A key has 11 groups of 5 letters and digits.')
  }
  const secret = full.slice(0, KEY_BYTES)
  const check = await checkBytes(secret)
  if (check.some((byte, i) => byte !== full[KEY_BYTES + i])) {
    throw new SyncKeyError('That sync key has a typo somewhere. Check it against the one you saved.')
  }
  return secret
}

/* ---------- Keys derived from the sync key ---------- */

export interface SyncKeys {
  encKey: CryptoKey
  token: string
}

export async function deriveKeys(secret: Bytes): Promise<SyncKeys> {
  const material = await crypto.subtle.importKey('raw', secret, 'HKDF', false, ['deriveKey', 'deriveBits'])
  const salt = encoder.encode('control-room/sync/v1')
  const encKey = await crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt, info: encoder.encode('record encryption') },
    material,
    { name: 'AES-GCM', length: 256 },
    false, // not extractable: usable for encrypting, but its bytes cannot be read back out
    ['encrypt', 'decrypt'],
  )
  const tokenBits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt, info: encoder.encode('server access token') },
    material,
    256,
  )
  return { encKey, token: toBase64(new Uint8Array(tokenBits)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') }
}

/* ---------- Sealing one record ---------- */

const FORMAT = 1
const NONCE_BYTES = 12
const TAG_BYTES = 16
/** Plaintext is padded to a multiple of this, so a blob's size reveals little about its content. */
const PAD_BLOCK = 256

function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binary)
}

function fromBase64(text: string): Bytes {
  const binary = atob(text)
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
  return out
}

/** Ties a blob to the record id it was made for, so the server cannot hand one record's data out as another's. */
const boundTo = (id: string) => encoder.encode(`control-room/record/v1/${id}`)

/** Encrypt a value for the record `id`. Returns base64 text: format byte, nonce, ciphertext with its integrity tag. */
export async function seal(key: CryptoKey, id: string, value: unknown): Promise<string> {
  const json = encoder.encode(JSON.stringify(value))
  const padded = new Uint8Array(Math.ceil((4 + json.length) / PAD_BLOCK) * PAD_BLOCK)
  new DataView(padded.buffer).setUint32(0, json.length)
  padded.set(json, 4)
  // A fresh random nonce for every encryption. At 96 bits, repeats are not a practical concern at this volume.
  const nonce = crypto.getRandomValues(new Uint8Array(NONCE_BYTES))
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce, additionalData: boundTo(id) }, key, padded))
  const out = new Uint8Array(1 + NONCE_BYTES + sealed.length)
  out[0] = FORMAT
  out.set(nonce, 1)
  out.set(sealed, 1 + NONCE_BYTES)
  return toBase64(out)
}

/**
 * Decrypt a blob for the record `id`. Throws if the blob was altered, was made for another record,
 * or was encrypted with a different key. AES-GCM checks integrity before it releases any plaintext.
 */
export async function open(key: CryptoKey, id: string, blob: string): Promise<unknown> {
  const bytes = fromBase64(blob)
  if (bytes.length < 1 + NONCE_BYTES + TAG_BYTES + PAD_BLOCK || bytes[0] !== FORMAT) throw new Error('Unknown blob format.')
  const nonce = bytes.slice(1, 1 + NONCE_BYTES)
  const padded = new Uint8Array(
    await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce, additionalData: boundTo(id) }, key, bytes.slice(1 + NONCE_BYTES)),
  )
  const length = new DataView(padded.buffer).getUint32(0)
  if (length > padded.length - 4) throw new Error('Corrupt blob.')
  return JSON.parse(decoder.decode(padded.subarray(4, 4 + length)))
}
