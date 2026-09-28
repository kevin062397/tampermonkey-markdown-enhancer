import { readFileSync } from "node:fs";

import type { MonkeyUserScript } from "vite-plugin-monkey";

const icon = `data:image/png;base64,${readFileSync("assets/script-icon-markdown-16.png", "base64")}`;
const icon64 = `data:image/png;base64,${readFileSync("assets/script-icon-markdown-64.png", "base64")}`;

const userscript: MonkeyUserScript = {
    name: "Markdown Enhancer",
    author: "Haoyuan Kevin Xia",
    description: "Enhance Markdown editing experience.",
    namespace: "https://github.com/kevin062397/TampermonkeyMarkdownEnhancer",
    version: "1.5.0",
    match: "*://*/*",
    grant: "none",
    icon,
    icon64
};

export default userscript;
