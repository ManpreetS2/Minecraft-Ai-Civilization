import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['tools/v1-acceptance/**/*.test.ts'], environment: 'node' } });
