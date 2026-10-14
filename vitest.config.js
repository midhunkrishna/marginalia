import { defineConfig } from "vitest/config";

// Pure-core specs run in Node (fast). DOM-bound specs opt in per-file with a
// `// @vitest-environment jsdom` docblock at the top of the file.
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.js"],
    coverage: {
      provider: "v8",
      include: [
        "src/core/**",
        "src/shared/**",
        "src/background/**",
        "src/content/**",
        "src/onboarding/**",
        "src/{gemini,claude,openai,googleai,anthropic,openrouter}/**",
        "src/search/**",
      ],
      reporter: ["text", "html"],
    },
  },
});
