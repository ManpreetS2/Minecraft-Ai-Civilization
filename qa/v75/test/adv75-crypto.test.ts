// Independent cryptographic re-verification of the M2 fix. Torsion points are derived from the curve equation, signatures come
// from a QA-owned RFC 8032 signer, and every case also runs through the PEM, KeyObject and base64 key paths.
import { createPublicKey, generateKeyPairSync, randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { parseEd25519PublicKey, parseEd25519Signature, verifySourceAttestation } from "../../../experiments/evidence-validator/src/index.js";
import * as ed from "../lib/ed25519.js";
import { liveJournal, paramsFor, EXP, SHA, AUTH } from "../lib/live.js";
import { payloadOf, type AttParams } from "../lib/journal.js";

const SPKI = Buffer.from("302a300506032b6570032100", "hex");
const pem = (raw: Buffer) => `-----BEGIN PUBLIC KEY-----\n${Buffer.concat([SPKI, raw]).toString("base64").match(/.{1,64}/g)!.join("\n")}\n-----END PUBLIC KEY-----`;
const l = liveJournal(); const base: AttParams = paramsFor(l);
const audit = (att: unknown, key: unknown) => verifySourceAttestation({ attestation: att as never, expectedExperimentId: EXP, expectedSourceSha: SHA, rawJournalLines: l.lines,
  firstServerTick: base.firstServerTick, lastServerTick: base.lastServerTick, totalServerTicks: base.totalServerTicks, trustedKeys: { [AUTH]: key as never } });
const att = (sigHex: string) => ({ sourceType: "paper_server_attested", signingAuthority: AUTH, signature: `ed25519:${sigHex}`, ...base });

describe("independent signer: valid controls must still work", () => {
  it("our BigInt RFC 8032 signer interoperates with node:crypto key import and with the validator (PEM, hex, base64, KeyObject)", () => {
    for (let i = 0; i < 12; i++) {
      const seed = randomBytes(32); const pub = ed.publicKey(seed); const sig = ed.sign(seed, payloadOf(base));
      const a = att(sig.toString("hex"));
      for (const [name, k] of [["pem", pem(pub)], ["hex", pub.toString("hex")], ["b64", pub.toString("base64")], ["keyobject", createPublicKey(pem(pub))]] as const) {
        const r = audit(a, k);
        expect(r.proven, `${name} seed#${i}: ${r.reasons.join("|")}`).toBe(true);
      }
    }
  });
  it("the curve arithmetic is sound: base point has order L, derived torsion subgroup has exactly 8 distinct points of order dividing 8", () => {
    expect(ed.eq(ed.mul(ed.BASE, ed.L), ed.IDENTITY)).toBe(true);
    const t = ed.torsionSubgroup();
    expect(new Set(t.map((x) => ed.encode(x).toString("hex"))).size).toBe(8);
    for (const x of t) expect(ed.eq(ed.mul(x, 8n), ed.IDENTITY)).toBe(true);
  });
  it("node:crypto-generated keys (many, random) are never falsely rejected by the new key checks", () => {
    for (let i = 0; i < 60; i++) { const { publicKey } = generateKeyPairSync("ed25519"); expect(() => parseEd25519PublicKey(publicKey)).not.toThrow(); }
  });
});

describe("small-order and non-canonical public keys (independently enumerated)", () => {
  const enc = ed.torsionEncodings();
  it(`enumerated ${enc.length} encodings of the 8 torsion points (canonical, sign-flipped, non-canonical y+p): every one is rejected as a trust root via hex, base64, PEM and KeyObject`, () => {
    const accepted: string[] = [];
    for (const { hex, why } of enc) {
      const raw = Buffer.from(hex, "hex");
      for (const [path, input] of [["hex", hex], ["b64", raw.toString("base64")], ["pem", pem(raw)]] as const) {
        try { parseEd25519PublicKey(input); accepted.push(`${why} via ${path} (${hex.slice(0, 12)}…)`); } catch { /* rejected */ }
      }
      try { parseEd25519PublicKey(createPublicKey({ key: Buffer.concat([SPKI, raw]), format: "der", type: "spki" })); accepted.push(`${why} via KeyObject`); } catch { /* rejected or unimportable */ }
    }
    console.log("TORSION_ENCODINGS", enc.length, "ACCEPTED", accepted.length, accepted.slice(0, 6).join(" ; "));
    expect(accepted).toEqual([]);
  });
  it("forged signatures (R = any torsion point, S in {0,1,L-1}) under every torsion trust-root are never proven", () => {
    const proven: string[] = [];
    for (const { hex: aHex } of enc) for (const { hex: rHex } of enc.slice(0, 12)) for (const S of [0n, 1n, ed.L - 1n]) {
      const sig = Buffer.concat([Buffer.from(rHex, "hex"), ed.leBytes(S)]).toString("hex");
      if (audit(att(sig), aHex).proven) proven.push(`A=${aHex.slice(0, 8)} R=${rHex.slice(0, 8)} S=${S}`);
    }
    expect(proven).toEqual([]);
  });
  it("trust root that is not on the curve, wrong length, or y >= p (non-canonical) is rejected", () => {
    for (const hex of ["ff".repeat(32), "ee" + "ff".repeat(30) + "7f", "ed" + "ff".repeat(30) + "7f", "02" + "00".repeat(31)]) {
      expect(audit(att("00".repeat(64)), hex).proven, hex.slice(0, 8)).toBe(false);
    }
  });
});

describe("signature mutation and malleability against a valid key", () => {
  const seed = randomBytes(32); const pub = ed.publicKey(seed); const sig = ed.sign(seed, payloadOf(base));
  it("control proven", () => { expect(audit(att(sig.toString("hex")), pem(pub)).proven).toBe(true); });
  it("flipping ANY single one of the 512 signature bits is never proven", () => {
    let proven = 0;
    for (let bit = 0; bit < 512; bit++) { const m = Buffer.from(sig); m[bit >> 3]! ^= 1 << (bit & 7); if (audit(att(m.toString("hex")), pem(pub)).proven) proven += 1; }
    expect(proven).toBe(0);
  });
  it("flipping ANY single bit of the trust-root key is never proven", () => {
    let proven = 0;
    for (let bit = 0; bit < 256; bit++) { const m = Buffer.from(pub); m[bit >> 3]! ^= 1 << (bit & 7); if (audit(att(sig.toString("hex")), m.toString("hex")).proven) proven += 1; }
    expect(proven).toBe(0);
  });
  it("S + k*L (non-canonical scalar) for every k that fits in 256 bits is rejected", () => {
    const S = ed.le(sig.subarray(32)); let k = 1n, tested = 0;
    while (S + k * ed.L < 2n ** 256n) { const m = Buffer.concat([sig.subarray(0, 32), ed.leBytes(S + k * ed.L)]); expect(audit(att(m.toString("hex")), pem(pub)).proven, `k=${k}`).toBe(false); k += 1n; tested += 1; }
    expect(tested).toBeGreaterThan(0);
  });
  it("R with y >= p, or the identity/order-2 point as R with a valid key, is rejected", () => {
    for (const r of ["ff".repeat(32), "ee" + "ff".repeat(30) + "7f", "01" + "00".repeat(31), "ec" + "ff".repeat(30) + "7f"]) {
      expect(audit(att(Buffer.concat([Buffer.from(r, "hex"), sig.subarray(32)]).toString("hex")), pem(pub)).proven).toBe(false);
    }
    expect(parseEd25519Signature("ed25519:" + "01" + "00".repeat(31) + "00".repeat(32)).sigBuffer).toBeNull();
  });
  it("a signature made for a different payload (each of the 12 signed fields changed) is never proven", () => {
    const keys: Array<keyof AttParams> = ["experimentId", "captureSessionId", "serverBuild", "serverVersion", "sourceSha", "evidenceDigest", "startedAt", "endedAt", "firstServerTick", "lastServerTick", "totalServerTicks"];
    for (const k of keys) {
      const other = { ...base, [k]: typeof base[k] === "number" ? (base[k] as number) + 1 : String(base[k]).replace(/.$/, (c) => (c === "0" ? "1" : "0")) } as AttParams;
      const s2 = ed.sign(seed, payloadOf(other)); // validly signed, but for different content than the attestation carries
      expect(audit(att(s2.toString("hex")), pem(pub)).proven, String(k)).toBe(false);
    }
  });
  it("a different valid keypair's signature, and a valid signature over the right payload by an untrusted key, are rejected", () => {
    const seed2 = randomBytes(32);
    expect(audit(att(ed.sign(seed2, payloadOf(base)).toString("hex")), pem(pub)).proven).toBe(false);
  });
});
