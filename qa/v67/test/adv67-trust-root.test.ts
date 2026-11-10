// Ed25519 trust-root handling and payload integrity, exercised against the real verifier with synthetic keys only.
import { describe, expect, it } from "vitest";
import { createPublicKey, createSecretKey, generateKeyPairSync, createPrivateKey } from "node:crypto";
import { parseEd25519PublicKey, parseEd25519Signature, verifySourceAttestation } from "../../../experiments/evidence-validator/src/index.js";
import { liveJournal, paramsFor, attest, validateLive, AUTH, EXP, SHA, key } from "../lib/live.js";
import { newKey } from "../lib/journal.js";

const l = liveJournal();
const base = () => paramsFor(l);
const audit = (att: unknown, trustedKeys: Record<string, unknown> | Map<string, unknown> = { [AUTH]: key.publicPem }, extra: Record<string, unknown> = {}) =>
  verifySourceAttestation({ attestation: att as never, expectedExperimentId: EXP, expectedSourceSha: SHA, rawJournalLines: l.lines,
    firstServerTick: base().firstServerTick, lastServerTick: base().lastServerTick, totalServerTicks: base().totalServerTicks, trustedKeys: trustedKeys as never, ...extra });

describe("trust root: key parsing", () => {
  it("control: the honest attestation is proven with the correct key (PEM, raw hex, raw base64 and KeyObject forms)", () => {
    const att = attest(base());
    for (const k of [key.publicPem, key.rawHex, Buffer.from(key.rawHex, "hex").toString("base64"), createPublicKey(key.publicPem)]) {
      expect(audit(att, { [AUTH]: k }).proven).toBe(true);
    }
  });
  it("rejects a wrong public key", () => {
    expect(audit(attest(base()), { [AUTH]: newKey().publicPem }).proven).toBe(false);
  });
  it("rejects a PRIVATE key (PEM and KeyObject) used as trust root", () => {
    const att = attest(base());
    expect(audit(att, { [AUTH]: key.privatePem }).authorityTrusted).toBe(false);
    expect(audit(att, { [AUTH]: createPrivateKey(key.privatePem) }).authorityTrusted).toBe(false);
    expect(() => parseEd25519PublicKey(key.privatePem)).toThrow();
  });
  it("rejects RSA, P-256 and secret-key material as trust root", () => {
    const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 }).publicKey.export({ type: "spki", format: "pem" }).toString();
    const ec = generateKeyPairSync("ec", { namedCurve: "P-256" }).publicKey.export({ type: "spki", format: "pem" }).toString();
    const att = attest(base());
    for (const k of [rsa, ec, createSecretKey(Buffer.alloc(32, 7))]) expect(audit(att, { [AUTH]: k }).authorityTrusted).toBe(false);
  });
  it("rejects empty / whitespace / wrong-length / non-key trust root strings", () => {
    const att = attest(base());
    for (const k of ["", "   ", "undefined", "null", key.rawHex.slice(0, 62), key.rawHex + "00", "zz".repeat(32), "-----BEGIN PUBLIC KEY-----\nAAAA\n-----END PUBLIC KEY-----"]) {
      const a = audit(att, { [AUTH]: k });
      expect(a.proven, `trust root ${JSON.stringify(k).slice(0, 40)}`).toBe(false);
    }
  });
  it("authority names that collide with Object.prototype members fail closed (plain-object trust root)", () => {
    for (const name of ["__proto__", "constructor", "toString", "hasOwnProperty", "valueOf"]) {
      const att = attest(base(), key.privatePem, name);
      const a = audit(att, { [AUTH]: key.publicPem });
      expect(a.proven, name).toBe(false);
      expect(a.authorityTrusted, name).toBe(false);
    }
  });
  it("attestation claiming authority B but signed by key A (B registered with a different key) is rejected", () => {
    const other = newKey();
    const att = attest(base(), key.privatePem, "authority-b");
    expect(audit(att, { "authority-b": other.publicPem, [AUTH]: key.publicPem }).proven).toBe(false);
  });
  it("[QA67-L3] trustedAuthorities allow-list: an authority NOT in the allow-list must not be proven (dead-parameter probe)", () => {
    const a = audit(attest(base()), { [AUTH]: key.publicPem }, { trustedAuthorities: ["some-other-authority"] });
    console.log("TRUSTED_AUTHORITIES_PROBE proven=", a.proven);
    expect(a.proven).toBe(false);
  });
});

describe("trust root: degenerate keys and signatures", () => {
  const identityHex = "01" + "00".repeat(31); // neutral element, order 1
  const order2Hex = "ecff" + "ff".repeat(29) + "7f"; // (0,-1), order 2
  it("[QA67-M2] a small-order trust-root key must not let anyone forge a signature (identity point, R=identity, S=0)", () => {
    const p = base();
    const att = { ...attest(p), signature: "ed25519:" + identityHex + "00".repeat(32) };
    const a = audit(att, { [AUTH]: identityHex });
    console.log("SMALL_ORDER_IDENTITY signatureValid=", a.signatureValid, "proven=", a.proven, a.reasons.slice(0, 2));
    expect(a.signatureValid).toBe(false);
  });
  it("[QA67-M2] a small-order trust-root key (order 2) must not verify a forged signature", () => {
    const att = { ...attest(base()), signature: "ed25519:" + identityHex + "00".repeat(32) };
    const a = audit(att, { [AUTH]: order2Hex });
    console.log("SMALL_ORDER_2 signatureValid=", a.signatureValid);
    expect(a.signatureValid).toBe(false);
  });
  it("rejects a non-canonical signature (S + L) for an otherwise valid signature", () => {
    const att = attest(base());
    const sig = Buffer.from(att.signature.slice(8), "hex");
    const L = 2n ** 252n + 27742317777372353535851937790883648493n;
    const S = BigInt("0x" + Buffer.from(sig.subarray(32)).reverse().toString("hex"));
    const S2 = S + L;
    const s2 = Buffer.from(S2.toString(16).padStart(64, "0"), "hex").reverse();
    expect(S2 < 2n ** 256n).toBe(true);
    const forged = { ...att, signature: "ed25519:" + Buffer.concat([sig.subarray(0, 32), s2]).toString("hex") };
    expect(audit(forged).signatureValid).toBe(false);
  });
  it("signature encodings: wrong length, garbage, double prefix, embedded whitespace, truncated", () => {
    const att = attest(base());
    const hex = att.signature.slice(8);
    const cases = [hex.slice(0, 126), hex + "00", "ed25519:" + att.signature, hex.slice(0, 60) + " " + hex.slice(60), "", "ed25519:", "zz".repeat(64), Buffer.alloc(64).toString("hex")];
    for (const c of cases) {
      const a = audit({ ...att, signature: c });
      expect(a.proven, JSON.stringify(c).slice(0, 30)).toBe(false);
    }
    expect(parseEd25519Signature("ed25519:" + hex).sigBuffer?.length).toBe(64);
  });
  it("accepts the same signature as base64 (documented encoding) and as uppercase hex without weakening verification", () => {
    const att = attest(base());
    const hex = att.signature.slice(8);
    expect(audit({ ...att, signature: Buffer.from(hex, "hex").toString("base64") }).proven).toBe(true);
    expect(audit({ ...att, signature: hex.toUpperCase() }).proven).toBe(true);
  });
});

describe("payload integrity: every signed field is covered", () => {
  const flips: Array<[string, (p: ReturnType<typeof base>) => Record<string, unknown>]> = [
    ["experimentId", () => ({ experimentId: "exp-other" })],
    ["captureSessionId", () => ({ captureSessionId: "b1b2c3d4-e5f6-7890-abcd-ef1234567890" })],
    ["serverBuild", (p) => ({ serverBuild: p.serverBuild + 1 })],
    ["serverVersion", () => ({ serverVersion: "1.21.7" })],
    ["sourceSha", () => ({ sourceSha: "a".repeat(40) })],
    ["evidenceDigest", () => ({ evidenceDigest: "b".repeat(64) })],
    ["startedAt", () => ({ startedAt: "2026-11-05T11:59:59.000Z" })],
    ["endedAt", () => ({ endedAt: "2026-11-05T13:00:01.000Z" })],
    ["firstServerTick", (p) => ({ firstServerTick: p.firstServerTick + 1 })],
    ["lastServerTick", (p) => ({ lastServerTick: p.lastServerTick + 1 })],
    ["totalServerTicks", (p) => ({ totalServerTicks: p.totalServerTicks + 1 })],
  ];
  for (const [field, f] of flips) {
    it(`changing '${field}' after signing is never proven`, () => {
      const p = base();
      const att = { ...attest(p), ...f(p) };
      expect(audit(att).proven).toBe(false);
    });
  }
  it("serverVersion / serverBuild / captureSessionId changes are caught by the SIGNATURE itself (no other check covers them)", () => {
    const p = base();
    for (const f of ["serverVersion", "serverBuild"] as const) {
      const att = { ...attest(p), ...flips.find(([n]) => n === f)![1](p) };
      expect(audit(att).signatureValid, f).toBe(false);
    }
    const att = { ...attest(p), captureSessionId: "b1b2c3d4-e5f6-7890-abcd-ef1234567890" };
    expect(audit(att).signatureValid).toBe(false);
  });
  it("replay of an attestation against a different / extended / re-ordered / re-encoded journal is rejected", () => {
    const att = attest(base());
    const lines = l.lines;
    const variants: Record<string, string[]> = {
      extended: [...lines, lines[lines.length - 1]!],
      dropped: lines.slice(0, -1),
      swapped: [lines[0]!, lines[2]!, lines[1]!, ...lines.slice(3)],
      crlf: lines.map((x) => x + "\r"),
      padded: lines.map((x) => " " + x),
    };
    for (const [n, v] of Object.entries(variants)) {
      const a = verifySourceAttestation({ attestation: att as never, expectedExperimentId: EXP, expectedSourceSha: SHA, rawJournalLines: v,
        firstServerTick: base().firstServerTick, lastServerTick: base().lastServerTick, totalServerTicks: base().totalServerTicks, trustedKeys: { [AUTH]: key.publicPem } });
      expect(a.proven, n).toBe(false);
    }
  });
  it("unsigned-field injection: control characters in signed text fields are not rejected (canonical-encoding hygiene probe)", () => {
    const p = { ...base(), serverVersion: "1.21.6\nserver_build:1" };
    const a = audit(attest(p));
    console.log("NEWLINE_IN_SIGNED_FIELD proven=", a.proven);
    expect(typeof a.proven).toBe("boolean");
  });
  it("end-to-end: a validly signed attestation for ANOTHER experiment/source never reaches real_minecraft", () => {
    for (const o of [{ experimentId: "other-exp" }, { sourceSha: "c".repeat(40) }]) {
      const att = attest({ ...base(), ...o });
      const r = validateLive(l, att);
      expect(r.mode).not.toBe("real_minecraft");
      expect(r.overallStatus).not.toBe("VERIFIED");
    }
  });
});

describe("end-to-end consequence of a degenerate trust root", () => {
  it("[QA67-M2] with an identity-point trust root, a signature forged WITHOUT any private key must not yield real_minecraft", () => {
    const identityHex = "01" + "00".repeat(31);
    const forged = { ...attest(base()), signature: "ed25519:" + identityHex + "00".repeat(32) };
    const r = validateLive(l, forged, { trustedKeys: { [AUTH]: identityHex } });
    console.log("FORGED_E2E mode=", r.mode, "status=", r.overallStatus, "attestationProven=", r.sourceAttestationAudit?.proven);
    expect(r.mode).not.toBe("real_minecraft");
  });
  it("[QA67-M2] parseEd25519PublicKey must not accept the identity point, the order-2 point or the all-zero encoding as a public key", () => {
    let accepted = 0;
    for (const hex of ["01" + "00".repeat(31), "ecff" + "ff".repeat(29) + "7f", "00".repeat(32)]) {
      try { parseEd25519PublicKey(hex); accepted++; } catch { /* rejected */ }
    }
    console.log("DEGENERATE_KEYS_ACCEPTED", accepted, "of 3");
    expect(accepted).toBe(0);
  });
});
