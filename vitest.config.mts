import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { include: ["tests/**/*.test.ts"], environment: "node" },
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
});
