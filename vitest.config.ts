import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    // `__live-*` checks call real providers with the account's own keys
    // and cost money. They can't run here anyway — the dummy secrets
    // below can't decrypt what's stored in the database — so keep them
    // out of the default suite and out of CI. Run them deliberately:
    //   npx vitest run --config vitest.live.config.ts
    exclude: ["**/node_modules/**", "src/**/__live-*.test.ts"],
    // Dummy secrets — encryption.ts / webhook-signature.ts read these
    // at module load. Tests never hit a real Meta/Supabase service, so
    // any 32-byte hex / non-empty string will do; keep them lexically
    // identical to the CI build env so behaviour matches.
    env: {
      ENCRYPTION_KEY:
        "0000000000000000000000000000000000000000000000000000000000000000",
      META_APP_SECRET: "test-meta-app-secret",
    },
    clearMocks: true,
  },
});
