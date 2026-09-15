import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  dts: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
  target: "es2020",
  // Keep MediaPipe external so the host app controls its version and the
  // wasm/model assets are served/hosted by the consumer.
  external: ["@mediapipe/tasks-vision"],
});
