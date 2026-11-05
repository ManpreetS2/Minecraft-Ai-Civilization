# Mission 007 — Claude independent QA handoff

**Frozen release candidate:** `a176fcaee0e4e72cf2d40a738d3bfcad5343cc80`  
**PR:** https://github.com/ManpreetS2/Minecraft-Ai-Civilization-windows-backup/pull/56  
**Author matrix:** `docs/MISSION007_MATRIX.md` (author-only — not OFFLINE_PASS)

## Reproduce

```bash
git fetch windows-backup agents/cursor-v1-single-sha-integration
git checkout a176fcaee0e4e72cf2d40a738d3bfcad5343cc80
pnpm install
pnpm typecheck && pnpm lint && pnpm build
pnpm test:v1
pnpm test:evidence-validator
pnpm v1:offline 2 artifacts/v1/claude-qa-m007-2
pnpm v1:offline 4 artifacts/v1/claude-qa-m007-4
```

## Ask Claude to verify on this exact SHA

1. Evidence Contract V2 receipts bind to executed gather attempts (not end-state invention).
2. Gemini Ed25519 suite (`phase2-crypto-verification`) green; incomplete attestation suite fails closed.
3. Offline Gemini reports remain **NOT_PROVEN** for Paper authenticity (no synthetic keypair treated as live Paper).
4. Negative: receipt digest mismatch, journal hash tamper, attestation digest mismatch.
5. Do **not** grant `OFFLINE_PASS` from author greens alone.
6. OFF-13/OFF-14 remain CODEX 1.2 blocked (`docs/MISSION007_OFF13_OFF14_HANDOFF.md`).

## Gate A

**Not ready** until independent review on this SHA and ownership gates clear. Live gates remain **0/2**.
