import path from "node:path";
import { defineProject, mergeConfig } from "vitest/config";
import shared from "../../vitest.shared.js";

export default mergeConfig(
  shared,
  defineProject({
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "."),
        shared: path.resolve(__dirname, "../../packages/shared/src/index.ts"),
      },
    },
    test: {
      name: "pwa",
      include: ["lib/**/*.test.ts", "src/**/*.test.ts"],
    },
  }),
);
