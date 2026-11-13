// QA-owned, independent RFC 8032 Ed25519 (BigInt). Used ONLY to (a) enumerate the 8-torsion subgroup from the curve equation,
// not from the implementation under review, and (b) sign with a signer that shares no code with node:crypto or the validator.
import { createHash } from "node:crypto";

export const P = 2n ** 255n - 19n;
export const L = 2n ** 252n + 27742317777372353535851937790883648493n;
const mod = (a: bigint, m = P) => ((a % m) + m) % m;
function pow(b: bigint, e: bigint, m = P): bigint { let r = 1n; b = mod(b, m); while (e > 0n) { if (e & 1n) r = (r * b) % m; b = (b * b) % m; e >>= 1n; } return r; }
const inv = (a: bigint) => pow(a, P - 2n);
const D = mod(-121665n * inv(121666n));
const SQRT_M1 = pow(2n, (P - 1n) / 4n);
export type Pt = { X: bigint; Y: bigint; Z: bigint; T: bigint };
export const IDENTITY: Pt = { X: 0n, Y: 1n, Z: 1n, T: 0n };
export function add(p1: Pt, p2: Pt): Pt {
  const A = mod((p1.Y - p1.X) * (p2.Y - p2.X)), B = mod((p1.Y + p1.X) * (p2.Y + p2.X)), C = mod(p1.T * 2n * D * p2.T), Dd = mod(p1.Z * 2n * p2.Z);
  const E = B - A, F = Dd - C, G = Dd + C, H = B + A;
  return { X: mod(E * F), Y: mod(G * H), T: mod(E * H), Z: mod(F * G) };
}
export function mul(pt: Pt, k: bigint): Pt { let r = IDENTITY, q = pt; while (k > 0n) { if (k & 1n) r = add(r, q); q = add(q, q); k >>= 1n; } return r; }
export const affine = (p: Pt) => { const zi = inv(p.Z); return { x: mod(p.X * zi), y: mod(p.Y * zi) }; };
export const eq = (a: Pt, b: Pt) => mod(a.X * b.Z) === mod(b.X * a.Z) && mod(a.Y * b.Z) === mod(b.Y * a.Z);
export function encode(pt: Pt): Buffer {
  const { x, y } = affine(pt); const b = Buffer.alloc(32); let v = y | ((x & 1n) << 255n);
  for (let i = 0; i < 32; i++) { b[i] = Number(v & 0xffn); v >>= 8n; } return b;
}
export function decode(b: Buffer): Pt | undefined {
  let v = 0n; for (let i = 31; i >= 0; i--) v = (v << 8n) | BigInt(b[i]!);
  const sign = (v >> 255n) & 1n; const y = v & ((1n << 255n) - 1n); if (y >= P) return undefined;
  const y2 = mod(y * y), x2 = mod((y2 - 1n) * inv(D * y2 + 1n)); let x = pow(x2, (P + 3n) / 8n);
  if (mod(x * x - x2) !== 0n) x = mod(x * SQRT_M1); if (mod(x * x - x2) !== 0n) return undefined;
  if (x === 0n && sign === 1n) return undefined; if ((x & 1n) !== sign) x = mod(-x);
  return { X: x, Y: y, Z: 1n, T: mod(x * y) };
}
const BY = mod(4n * inv(5n));
export const BASE = (() => { const y2 = mod(BY * BY); let x = pow(mod((y2 - 1n) * inv(D * y2 + 1n)), (P + 3n) / 8n); if (mod(x * x - mod((y2 - 1n) * inv(D * y2 + 1n))) !== 0n) x = mod(x * SQRT_M1); if (x & 1n) x = mod(-x); return { X: x, Y: BY, Z: 1n, T: mod(x * BY) }; })();
const sha512 = (...parts: Buffer[]) => createHash("sha512").update(Buffer.concat(parts)).digest();
const le = (b: Buffer) => { let v = 0n; for (let i = b.length - 1; i >= 0; i--) v = (v << 8n) | BigInt(b[i]!); return v; };
const leBytes = (v: bigint, n = 32) => { const b = Buffer.alloc(n); for (let i = 0; i < n; i++) { b[i] = Number(v & 0xffn); v >>= 8n; } return b; };
export function publicKey(seed: Buffer): Buffer { const h = sha512(seed); const a = clamp(h.subarray(0, 32)); return encode(mul(BASE, a)); }
function clamp(h: Buffer): bigint { const c = Buffer.from(h); c[0]! &= 248; c[31]! &= 127; c[31]! |= 64; return le(c); }
export function sign(seed: Buffer, msg: Buffer): Buffer {
  const h = sha512(seed); const a = clamp(h.subarray(0, 32)); const A = encode(mul(BASE, a));
  const r = le(sha512(h.subarray(32), msg)) % L; const R = encode(mul(BASE, r)); const k = le(sha512(R, A, msg)) % L;
  return Buffer.concat([R, leBytes((r + k * a) % L)]);
}
/** All 8 points of the small-order subgroup, derived from the curve: [L]*Q for a point Q of full order, then multiples. */
export function torsionSubgroup(): Pt[] {
  for (let y = 2n; y < 1000n; y++) {
    const q = decode(leBytes(y)); if (!q) continue;
    const t = mul(q, L); // lies in the 8-torsion subgroup
    if (eq(mul(t, 4n), IDENTITY)) continue; // need order exactly 8
    const out: Pt[] = []; let cur = IDENTITY; for (let i = 0; i < 8; i++) { out.push(cur); cur = add(cur, t); } return out;
  }
  throw new Error("no order-8 generator found");
}
/** Every byte encoding of those points a lenient decoder may accept: canonical, flipped sign bit, and y+P for y<19. */
export function torsionEncodings(): Array<{ hex: string; why: string }> {
  const seen = new Map<string, string>();
  torsionSubgroup().forEach((pt, i) => {
    const e = encode(pt); seen.set(e.toString("hex"), `torsion#${i} canonical`);
    const s = Buffer.from(e); s[31]! ^= 0x80; seen.set(s.toString("hex"), `torsion#${i} sign-bit flipped`);
    const y = le(e) & ((1n << 255n) - 1n);
    if (y < 19n) { for (const sg of [0n, 1n]) seen.set(leBytes((y + P) | (sg << 255n)).toString("hex"), `torsion#${i} non-canonical y+p sign=${sg}`); }
  });
  return [...seen].map(([hex, why]) => ({ hex, why }));
}
export { leBytes, le };
