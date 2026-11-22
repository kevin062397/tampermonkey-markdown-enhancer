# Tampermonkey Markdown Enhancer

Tampermonkey Markdown Enhancer improves Markdown editing in writable `<textarea>` elements. It provides safe paired-character editing, Markdown-aware keyboard behavior, reusable formatting commands, an accessible formatting toolbar, and a locally built Tampermonkey userscript.

The userscript applies to connected, writable textareas under the universal `@match *://*/*` rule. Delegated event handling supports textareas mounted or replaced after page load.

## Editing Behavior

### Shortcuts

The primary modifier is `Command` on macOS and `Control` on other platforms.

| Action                                                                               | Shortcut                            |
| ------------------------------------------------------------------------------------ | ----------------------------------- |
| Toggle bold                                                                          | Primary modifier + `B`              |
| Toggle italic                                                                        | Primary modifier + `I`              |
| Insert a Markdown link                                                               | Primary modifier + `K`              |
| Focus the formatting toolbar                                                         | `Alt+F10`                           |
| Let the next focus-navigation key leave the editor                                   | `Escape`, then `Tab` or `Shift+Tab` |
| Indent selected lines or the current bullet, numbered, task-list, or blockquote line | `Tab`                               |
| Outdent selected lines or the current line                                           | `Shift+Tab`                         |
| Continue or exit a Markdown line prefix                                              | `Enter`                             |

Bold and italic toggles preserve boundary whitespace and correctly transition existing asterisk marker depth. Link insertion turns selected text into `[text](url)` with the `url` placeholder selected; selecting a URL creates `[link text](url)` with the label selected.

### Paired Characters

- Typing `(`, `[`, `{`, or `<` with no selection inserts the matching closer and places the cursor inside.
- With a selection, `(`, `[`, `{`, `<`, `"`, `'`, `` ` ``, `_`, `*`, and `~` wrap the selected text.
- Typing a matched closing character at the cursor moves over it instead of duplicating it.
- `Backspace` between an empty recognized pair removes both characters.
- Escape-aware delimiter matching distinguishes literal characters, word-internal apostrophes, and properly nested pairs.

### Markdown Lines and Paste

- `Enter` continues bullet, numbered, task-list, blockquote, and indented lines. Numbered markers increment, task markers reset to unchecked, and pressing `Enter` on an empty prefixed line removes the prefix.
- With no selection outside a recognized bullet, numbered, task-list, or blockquote line, `Tab` inserts spaces to the next configured tab stop. The default width is four spaces.
- Pasting an `http`, `https`, `ftp`, or `mailto` URL over selected text creates an escaped Markdown link. Native paste behavior handles other clipboard content.
- The delegated handler yields to IME composition and page handlers that consume keyboard or paste events first.

## Built-In Command Registry

The runtime includes commands for bold, italic, strikethrough, inline code, fenced code blocks, links, headings 1–6, blockquotes, bullet lists, numbered lists, and task lists. Bold, italic, and link have direct keyboard shortcuts.

## Formatting Toolbar

Focusing an eligible textarea mounts one compact formatting toolbar beside it. Bold, italic, strikethrough, inline code, and link are icon buttons. The **Style** control shows the active block style with its icon, label, and a trailing chevron. Its grouped menu provides Text, Heading 1–6, Blockquote, Code Block, Bullet List, Numbered List, and Task List. A selection containing several block styles is labeled **Mixed**. Style commands apply to the selected lines or the cursor’s current line. Additional editor actions appear with icons and labels in **More formatting commands** when available.

The toolbar uses light and dark palettes. It follows the editor’s computed color scheme, nearby page theme attributes, or the browser’s preferred scheme, and updates as those signals change. High-contrast (forced colors) mode is supported.

Press `Alt+F10` from the textarea to focus the toolbar. Use Left and Right Arrow, Home, and End to move among its primary controls. The Style menu and any More menu support Up and Down Arrow, Home, End, and Escape. A primary pointer action elsewhere closes an open menu, then the selected page control handles the action normally. Executing a command restores editor focus and preserves the same behavior as its keyboard command. Press `Escape` in the textarea before `Tab` or `Shift+Tab` to let that next key move focus through the page; later Tab presses resume Markdown indentation. The toolbar follows the active textarea and cleans up when editors are replaced.

## Browser Compatibility

Current Chrome and Firefox releases with Tampermonkey are supported. After changes to the generated runtime, editor interaction, toolbar behavior, settings, or browser integration, check each browser for editor discovery and toolbar placement; keyboard, direct icon, and Style commands; outside-pointer dismissal; `Alt+F10` navigation and `Escape`-then-Tab focus exit; light, dark, and forced-colors palettes; settings actions; and cleanup after an editor is replaced.

## Settings

The Tampermonkey menu provides nine live actions for Markdown editing, formatting-toolbar visibility, tab width, bullet style, bold/italic/link shortcuts, the current hostname exclusion, and editor selector exclusions. The editing and toolbar actions are labeled **Enable** or **Disable** according to their current state. Their labels update immediately after activation and refresh from shared settings when the tab regains focus. **Set Bullet Style** accepts `-`, `*`, or `+`, shows the current value, and identifies `-` as the default. Leaving the bullet-style prompt blank restores that default.

On macOS, shortcut prompts use `Command` and accept `Command+B`, `Cmd+B`, or `mod+B`. On other platforms, prompts use `Control` and accept `Control+B`, `Ctrl+B`, or `mod+B`. Each shortcut prompt displays the current value and default; leaving it blank restores the default when that binding is available. The defaults are `Command`/`Control` + `B`, `I`, and `K` for bold, italic, and link.

The current-hostname action is labeled **Exclude This Hostname** or **Include This Hostname** according to its stored state. **Toggle Editor Exclusion Selector** shows the configured selectors and accepts one CSS selector at a time: enter a new selector to add it or an existing selector to remove it. Commas remain available for CSS selector lists. Up to 32 unique, valid selectors of 256 characters each are retained.

Tab-width, bullet-style, shortcut, and targeting changes or rejected values produce a concise browser message. Editing and toolbar toggles communicate their outcome through the updated menu label. A shortcut collision names the action that already owns the binding, and targeting messages identify the hostname or selector changed. Canceled prompts remain silent. Settings created by a newer schema remain unchanged and read-only, and unavailable storage is reported without interrupting editor behavior.

Settings are stored with the userscript. Toolbar visibility, editing, shortcut, and targeting changes apply without a page reload.

## Installation

Pull the repository and build it locally:

1. Install [Tampermonkey](https://www.tampermonkey.net/) in your browser.
2. Pull and build the repository:

    ```sh
    git clone https://github.com/kevin062397/tampermonkey-markdown-enhancer.git
    cd tampermonkey-markdown-enhancer
    npm ci
    npm run build
    ```

3. Create a userscript in Tampermonkey, replace its contents with `dist/index.user.js`, and save it.

To update the userscript, pull the repository changes, run `npm ci` and `npm run build`, and replace the installed userscript with the regenerated `dist/index.user.js`.

## Development

Install dependencies and run the authoritative verification command:

```sh
npm ci
npm run verify
```

`npm run verify` checks formatting without rewriting files, runs strict TypeScript checking, executes the full Vitest suite, and builds and validates the userscript artifacts.

Production builds run the formatter first. To format without building, run:

```sh
npm run format
```

The production build emits exactly:

- `dist/index.user.js`: the installable userscript.
- `dist/index.meta.js`: the Tampermonkey metadata block.

`npm run validate:build` checks both generated files. Unit tests are colocated with their source modules, and Vitest configuration remains in `vite.config.ts`. Generated artifacts are ignored.
