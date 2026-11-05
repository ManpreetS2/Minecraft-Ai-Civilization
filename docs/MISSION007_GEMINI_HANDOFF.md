# Mission 007 — Gemini validator handoff

**Integrated Gemini tip:** `fad541f2863473df8f9ffd119c09d631472eb37b`  
**Cursor release tip:** (see PR #56 HEAD after Mission 007 publish)

## Integrated as-is from Gemini

- Real Node `crypto.verify` Ed25519 path in `source-authenticator.ts`
- Canonical payload `AGY-PAPER-ATTESTATION-V1`
- Trusted public-key configuration (`trustedKeys`)
- `phase2-crypto-verification.test.ts` (15 vectors)
- `CURSOR_INTEGRATION_CONTRACT.md`, `PAPER_CAPTURE_DESIGN.md`
- Duration verifier trust-key / journal / expected SHA plumbing

## Cursor Phase B completeness gates (fail-closed)

Independent inspection found the Gemini tip could still set `proven=true` when signed fields were incomplete (missing journal, digest, sourceSha, timestamps, or tick ranges; payload rebuild used caller/computed fallbacks).

Cursor applied a **narrow completeness gate** inside `verifySourceAttestation` so Paper authenticity cannot be proven unless:

- Attested `sourceSha` (40-hex) is present and matches `expectedSourceSha`
- Attested `evidenceDigest` is present and matches the hashed `rawJournalLines`
- Attested `startedAt` / `endedAt` are present
- Attested tick range fields are present (caller-only ticks never substitute)
- Canonical payload is rebuilt **only** from attested fields (no empty / caller fallbacks)

Synthetic `createTestAttestationKeypair` / `signTestAttestation` fixtures remain **test-only** and must not be classified as genuine Paper evidence.

## Still Gemini-owned / NOT done

- Live Paper capture plugin and production signing authority ops
- Real Paper session capture feeding attestations
- Any remaining authenticator UX beyond completeness + Ed25519 verify

Coordinate further substantive crypto changes through Gemini; do not treat Cursor's completeness gate as ownership transfer of the validator.
