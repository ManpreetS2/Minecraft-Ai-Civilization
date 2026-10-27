# Construction 006A — Rollback

## Sacred originals (never delete / overwrite)

- World-Lab: `<WORKSPACE>\world-lab`
- SQLite: `<WORKSPACE>\data\world-lab-civilization.sqlite`
- server.properties SHA256: `7168f3f95f2a6c47f87cb64df1fc0f67d6f22f768a1c6db3a284e7d5e111b021`
- sqlite SHA256: `037a0f751fec685d411664be2815657b7b49ac7fffdb92e4443104bae51e57e4`

## Disposable isolated tree

- Root: `<WORKSPACE>\experiments\construction-006a`
- World-Lab copy: `<WORKSPACE>\experiments\construction-006a\world-lab-isolated`
- SQLite copy: `<WORKSPACE>\experiments\construction-006a\world-lab-civilization.sqlite`

## Rollback

1. Stop any Paper on ports **25568** / RCON **25578** (if ever started).
2. Delete only the disposable tree:
   ```
   Remove-Item -Recurse -Force "<WORKSPACE>\experiments\construction-006a"
   ```
3. Confirm originals still match recorded SHA256 hashes.
4. Do **not** restore by copying isolated → original.

## Emergency stop (if live ever authorized later)

1. Disconnect Atlas / kill Mineflayer process.
2. `stop` on Paper console (isolated only).
3. Do not run commands against 25567 / original world-lab.
