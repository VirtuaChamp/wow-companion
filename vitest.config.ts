import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "{apps,packages}/*/{src,test}/**/*.test.ts",
      "scripts/**/*.test.ts",
      "tests/**/*.test.ts",
    ],
  },
});
