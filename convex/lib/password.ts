// PBKDF2-HMAC-SHA256 implemented in plain TypeScript.
//
// Convex mutations run in a V8 isolate where `crypto.subtle` is not guaranteed
// to exist, and `"use node"` modules cannot be imported from files that also
// export a query/mutation. Hashing therefore lives here as a self-contained
// synchronous implementation — no native deps, identical behaviour everywhere.

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
  0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
  0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
  0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const BLOCK_SIZE = 64;
const HASH_LEN = 32;

const rotr = (x: number, n: number): number => (x >>> n) | (x << (32 - n));

function sha256(bytes: Uint8Array): Uint8Array {
  const h = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c,
    0x1f83d9ab, 0x5be0cd19,
  ]);

  // Pad to a multiple of 64 bytes: 0x80, zeros, then a 64-bit big-endian length.
  const padded = new Uint8Array((((bytes.length + 8) >> 6) + 1) << 6);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  const bitLen = bytes.length * 8;
  view.setUint32(padded.length - 8, Math.floor(bitLen / 0x100000000), false);
  view.setUint32(padded.length - 4, bitLen >>> 0, false);

  const w = new Uint32Array(64);
  for (let off = 0; off < padded.length; off += BLOCK_SIZE) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(off + i * 4, false);
    for (let i = 16; i < 64; i++) {
      const x = w[i - 15]!;
      const y = w[i - 2]!;
      const s0 = rotr(x, 7) ^ rotr(x, 18) ^ (x >>> 3);
      const s1 = rotr(y, 17) ^ rotr(y, 19) ^ (y >>> 10);
      w[i] = (w[i - 16]! + s0 + w[i - 7]! + s1) >>> 0;
    }

    let a = h[0]!;
    let b = h[1]!;
    let c = h[2]!;
    let d = h[3]!;
    let e = h[4]!;
    let f = h[5]!;
    let g = h[6]!;
    let hh = h[7]!;

    for (let i = 0; i < 64; i++) {
      const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + s1 + ch + K[i]! + w[i]!) >>> 0;
      const s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (s0 + maj) >>> 0;
      hh = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }

    h[0] = (h[0]! + a) >>> 0;
    h[1] = (h[1]! + b) >>> 0;
    h[2] = (h[2]! + c) >>> 0;
    h[3] = (h[3]! + d) >>> 0;
    h[4] = (h[4]! + e) >>> 0;
    h[5] = (h[5]! + f) >>> 0;
    h[6] = (h[6]! + g) >>> 0;
    h[7] = (h[7]! + hh) >>> 0;
  }

  const out = new Uint8Array(HASH_LEN);
  const outView = new DataView(out.buffer);
  for (let i = 0; i < 8; i++) outView.setUint32(i * 4, h[i]!, false);
  return out;
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a);
  out.set(b, a.length);
  return out;
}

function hmacSha256(key: Uint8Array, msg: Uint8Array): Uint8Array {
  const normalized = key.length > BLOCK_SIZE ? sha256(key) : key;
  const padded = new Uint8Array(BLOCK_SIZE);
  padded.set(normalized);

  const innerKey = new Uint8Array(BLOCK_SIZE);
  const outerKey = new Uint8Array(BLOCK_SIZE);
  for (let i = 0; i < BLOCK_SIZE; i++) {
    innerKey[i] = padded[i]! ^ 0x36;
    outerKey[i] = padded[i]! ^ 0x5c;
  }

  return sha256(concat(outerKey, sha256(concat(innerKey, msg))));
}

function pbkdf2(
  password: Uint8Array,
  salt: Uint8Array,
  iterations: number,
  dkLen: number,
): Uint8Array {
  const blocks = Math.ceil(dkLen / HASH_LEN);
  const out = new Uint8Array(blocks * HASH_LEN);
  const u = new Uint8Array(HASH_LEN);
  const t = new Uint8Array(HASH_LEN);

  for (let block = 1; block <= blocks; block++) {
    // U1 = HMAC(password, salt || INT_BE(block))
    const suffix = new Uint8Array(4);
    suffix[0] = (block >>> 24) & 0xff;
    suffix[1] = (block >>> 16) & 0xff;
    suffix[2] = (block >>> 8) & 0xff;
    suffix[3] = block & 0xff;

    u.set(hmacSha256(password, concat(salt, suffix)));
    t.set(u);
    for (let i = 1; i < iterations; i++) {
      u.set(hmacSha256(password, u));
      for (let j = 0; j < HASH_LEN; j++) t[j]! ^= u[j]!;
    }
    out.set(t, (block - 1) * HASH_LEN);
  }

  return out.subarray(0, dkLen);
}

// --- hex helpers ---------------------------------------------------------

const encoder = new TextEncoder();

function toHex(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += b.toString(16).padStart(2, "0");
  return s;
}

function fromHex(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function randomHex(byteLength: number): string {
  const bytes = new Uint8Array(byteLength);
  const maybeCrypto = (globalThis as { crypto?: Crypto }).crypto;
  if (maybeCrypto?.getRandomValues) {
    maybeCrypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < byteLength; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  return toHex(bytes);
}

/** Constant-time comparison so verification cannot be timed. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

// --- public API ----------------------------------------------------------

// 10k rounds of SHA-256 costs ~30ms here, which keeps a register/login well
// inside a Convex mutation's time budget. Raising it is a one-line change if
// this ever moves to a runtime with native `crypto.subtle` (600k+ rounds).
const ITERATIONS = 10_000;
const SALT_BYTES = 16;

/** Returns `pbkdf2$<iterations>$<saltHex>$<hashHex>`. */
export function hashPassword(password: string): string {
  const saltHex = randomHex(SALT_BYTES);
  const derived = pbkdf2(
    encoder.encode(password),
    fromHex(saltHex),
    ITERATIONS,
    HASH_LEN,
  );
  return `pbkdf2$${ITERATIONS}$${saltHex}$${toHex(derived)}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split("$");
  if (parts.length !== 4 || parts[0] !== "pbkdf2") return false;

  const iterations = Number(parts[1]);
  if (!Number.isFinite(iterations) || iterations <= 0) return false;

  let derived: Uint8Array;
  try {
    derived = pbkdf2(
      encoder.encode(password),
      fromHex(parts[2]!),
      iterations,
      HASH_LEN,
    );
  } catch {
    return false;
  }
  return timingSafeEqual(toHex(derived), parts[3]!);
}

/** Cryptographically random hex token for sessions and project invite codes. */
export function randomToken(byteLength = 24): string {
  return randomHex(byteLength);
}
