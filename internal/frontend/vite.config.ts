import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import license from "rollup-plugin-license";
import path from "node:path";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    outDir: "../static/dist",
    emptyOutDir: true,
    rollupOptions: {
      plugins: [
        license({
          thirdParty: {
            output: {
              file: path.resolve(__dirname, "CREDITS_FRONTEND"),
              template(dependencies) {
                return dependencies
                  .map(
                    (dep) => {
                      const repo = typeof dep.repository === "string"
                        ? dep.repository
                        : dep.repository?.url || "";
                      const url = repo || dep.homepage || "";
                      return `${dep.name}\n${url}\n----------------------------------------------------------------\n${dep.licenseText || `License: ${dep.license}`}\n`;
                    },
                  )
                  .join(
                    "\n================================================================\n\n",
                  );
              },
            },
          },
        }),
      ],
    },
  },
  server: {
    proxy: {
      "/_/": "http://localhost:6275",
    },
  },
  test: {
    include: ["src/**/*.test.{ts,tsx}"],
    environment: "jsdom",
    setupFiles: ["src/test-setup.ts"],
    coverage: {
      provider: "v8",
      include: ["src/utils/**", "src/hooks/**", "src/components/**"],
      reporter: ["text", "lcov"],
      reportsDirectory: "coverage",
    },
  },
});
