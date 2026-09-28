/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import monkey from "vite-plugin-monkey";
import userscript from "./configuration/userscript.ts";

export default defineConfig({
    plugins: [
        monkey({
            entry: "src/index.user.ts",
            userscript,
            build: {
                autoGrant: false,
                fileName: "index.user.js",
                metaFileName: true,
                systemjs: "inline"
            }
        })
    ],
    build: {
        emptyOutDir: true,
        minify: false,
        outDir: "dist",
        sourcemap: false,
        target: "es2015"
    },
    test: {
        environment: "jsdom"
    }
});
