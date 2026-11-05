import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['tools/v1-integration/{scenario,regressions}.test.ts'], setupFiles: ['./test-support/setup.ts'], environment: 'node', testTimeout: 20000 } });


