import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
    // Машина разработчика ограничена по RAM — не плодим воркеры.
    pool: "forks",
    maxWorkers: 2,
  },
});
