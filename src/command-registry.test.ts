import { afterEach, describe, expect, test, vi } from "vitest";
import {
    createCommandRegistry,
    EDITOR_COMMAND_IDS,
    type EditorCommand,
    type EditorCommandContext
} from "./command-registry";

const createTextArea = (value: string, selectionStart: number, selectionEnd: number): HTMLTextAreaElement => {
    const textArea = document.createElement("textarea");
    textArea.value = value;
    textArea.setSelectionRange(selectionStart, selectionEnd);
    document.body.append(textArea);
    return textArea;
};

afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
});

describe("Command registry", () => {
    test("exposes core command metadata and primary shortcuts", () => {
        const registry = createCommandRegistry();
        const context: EditorCommandContext = { textArea: createTextArea("value", 0, 5) };

        expect(registry.listCommands().map(({ id, label }) => ({ id, label }))).toEqual([
            { id: EDITOR_COMMAND_IDS.bold, label: "Bold" },
            { id: EDITOR_COMMAND_IDS.italic, label: "Italic" },
            { id: EDITOR_COMMAND_IDS.strikethrough, label: "Strikethrough" },
            { id: EDITOR_COMMAND_IDS.inlineCode, label: "Inline code" },
            { id: EDITOR_COMMAND_IDS.codeBlock, label: "Code block" },
            { id: EDITOR_COMMAND_IDS.link, label: "Link" },
            { id: EDITOR_COMMAND_IDS.heading1, label: "Heading 1" },
            { id: EDITOR_COMMAND_IDS.heading2, label: "Heading 2" },
            { id: EDITOR_COMMAND_IDS.heading3, label: "Heading 3" },
            { id: EDITOR_COMMAND_IDS.heading4, label: "Heading 4" },
            { id: EDITOR_COMMAND_IDS.heading5, label: "Heading 5" },
            { id: EDITOR_COMMAND_IDS.heading6, label: "Heading 6" },
            { id: EDITOR_COMMAND_IDS.blockquote, label: "Blockquote" },
            { id: EDITOR_COMMAND_IDS.bulletList, label: "Bullet list" },
            { id: EDITOR_COMMAND_IDS.numberedList, label: "Numbered list" },
            { id: EDITOR_COMMAND_IDS.taskList, label: "Task list" }
        ]);
        expect(registry.findCommandByShortcut("B", true, context)?.id).toBe(EDITOR_COMMAND_IDS.bold);
        expect(registry.findCommandByShortcut("i", true, context)?.id).toBe(EDITOR_COMMAND_IDS.italic);
        expect(registry.findCommandByShortcut("K", true, context)?.id).toBe(EDITOR_COMMAND_IDS.link);
        expect(registry.findCommandByShortcut("b", false, context)).toBeUndefined();
    });

    test("makes formatting unavailable for empty or whitespace-only selections", () => {
        const registry = createCommandRegistry();
        const textArea = createTextArea("   ", 0, 3);
        const context = { textArea };

        expect(registry.getCommand(EDITOR_COMMAND_IDS.bold)?.isAvailable(context)).toBe(false);
        expect(registry.getCommand(EDITOR_COMMAND_IDS.link)?.isAvailable(context)).toBe(false);
        expect(registry.getCommand(EDITOR_COMMAND_IDS.codeBlock)?.isAvailable(context)).toBe(true);
        expect(registry.executeCommand(EDITOR_COMMAND_IDS.bold, context)).toBe(false);
        expect(registry.executeCommand(EDITOR_COMMAND_IDS.link, context)).toBe(false);
        expect(textArea.value).toBe("   ");

        textArea.value = "value";
        textArea.setSelectionRange(0, 5);
        textArea.readOnly = true;
        expect(registry.getCommand(EDITOR_COMMAND_IDS.bold)?.isAvailable(context)).toBe(false);
        textArea.readOnly = false;
        textArea.disabled = true;
        expect(registry.getCommand(EDITOR_COMMAND_IDS.bold)?.isAvailable(context)).toBe(false);
    });

    test("preserves bold while toggling italic for marker-inclusive selections", () => {
        const registry = createCommandRegistry();
        const textArea = createTextArea("**hello**", 0, 9);
        const context = { textArea };

        expect(registry.executeCommand(EDITOR_COMMAND_IDS.italic, context)).toBe(true);
        expect(textArea.value).toBe("***hello***");
        expect([textArea.selectionStart, textArea.selectionEnd]).toEqual([3, 8]);

        expect(registry.executeCommand(EDITOR_COMMAND_IDS.italic, context)).toBe(true);
        expect(textArea.value).toBe("**hello**");
        expect([textArea.selectionStart, textArea.selectionEnd]).toEqual([2, 7]);
    });

    test("toggles split asterisk layers as combined formatting", () => {
        const registry = createCommandRegistry();
        const textArea = createTextArea("***hello***", 2, 9);
        const context = { textArea };

        expect(registry.executeCommand(EDITOR_COMMAND_IDS.italic, context)).toBe(true);
        expect(textArea.value).toBe("**hello**");
        expect([textArea.selectionStart, textArea.selectionEnd]).toEqual([2, 7]);

        textArea.value = "***hello***";
        textArea.setSelectionRange(1, 10);
        expect(registry.executeCommand(EDITOR_COMMAND_IDS.bold, context)).toBe(true);
        expect(textArea.value).toBe("*hello*");
        expect([textArea.selectionStart, textArea.selectionEnd]).toEqual([1, 6]);

        textArea.value = "**hello**";
        textArea.setSelectionRange(1, 8);
        expect(registry.executeCommand(EDITOR_COMMAND_IDS.italic, context)).toBe(true);
        expect(textArea.value).toBe("***hello***");
        expect([textArea.selectionStart, textArea.selectionEnd]).toEqual([3, 8]);

        textArea.value = "****hello****";
        textArea.setSelectionRange(2, 11);
        expect(registry.executeCommand(EDITOR_COMMAND_IDS.bold, context)).toBe(true);
        expect(textArea.value).toBe("**hello**");
        expect([textArea.selectionStart, textArea.selectionEnd]).toEqual([2, 7]);
    });

    test("toggles strikethrough outside content while preserving surrounding whitespace", () => {
        const registry = createCommandRegistry();
        const textArea = createTextArea("  hello  ", 0, 9);
        const context = { textArea };

        expect(registry.executeCommand(EDITOR_COMMAND_IDS.strikethrough, context)).toBe(true);
        expect(textArea.value).toBe("  ~~hello~~  ");
        expect([textArea.selectionStart, textArea.selectionEnd]).toEqual([4, 9]);

        expect(registry.executeCommand(EDITOR_COMMAND_IDS.strikethrough, context)).toBe(true);
        expect(textArea.value).toBe("  hello  ");
        expect([textArea.selectionStart, textArea.selectionEnd]).toEqual([2, 7]);
    });

    test("toggles inline-code markers included inside a whitespace-padded selection", () => {
        const registry = createCommandRegistry();
        const textArea = createTextArea("  `hello`  ", 0, 11);
        const context = { textArea };

        expect(registry.executeCommand(EDITOR_COMMAND_IDS.inlineCode, context)).toBe(true);
        expect(textArea.value).toBe("  hello  ");
        expect([textArea.selectionStart, textArea.selectionEnd]).toEqual([2, 7]);

        expect(registry.executeCommand(EDITOR_COMMAND_IDS.inlineCode, context)).toBe(true);
        expect(textArea.value).toBe("  `hello`  ");
        expect([textArea.selectionStart, textArea.selectionEnd]).toEqual([3, 8]);
    });

    test("removes external markers around whitespace-padded content", () => {
        const registry = createCommandRegistry();
        const textArea = createTextArea("~~  hello  ~~", 2, 11);
        const context = { textArea };

        expect(registry.executeCommand(EDITOR_COMMAND_IDS.strikethrough, context)).toBe(true);
        expect(textArea.value).toBe("  hello  ");
        expect([textArea.selectionStart, textArea.selectionEnd]).toEqual([2, 7]);

        textArea.value = "`  hello  `";
        textArea.setSelectionRange(1, 10);
        expect(registry.executeCommand(EDITOR_COMMAND_IDS.inlineCode, context)).toBe(true);
        expect(textArea.value).toBe("  hello  ");
        expect([textArea.selectionStart, textArea.selectionEnd]).toEqual([2, 7]);

        textArea.value = "~~hello~~";
        textArea.setSelectionRange(1, 8);
        expect(registry.executeCommand(EDITOR_COMMAND_IDS.strikethrough, context)).toBe(true);
        expect(textArea.value).toBe("hello");
        expect([textArea.selectionStart, textArea.selectionEnd]).toEqual([0, 5]);

        textArea.value = "``hello``";
        textArea.setSelectionRange(1, 8);
        expect(registry.executeCommand(EDITOR_COMMAND_IDS.inlineCode, context)).toBe(true);
        expect(textArea.value).toBe("hello");
        expect([textArea.selectionStart, textArea.selectionEnd]).toEqual([0, 5]);
    });

    test("executes the code-block command and selects its language placeholder", () => {
        const registry = createCommandRegistry();
        const textArea = createTextArea("code", 0, 4);
        const context = { textArea };

        expect(registry.executeCommand(EDITOR_COMMAND_IDS.codeBlock, context)).toBe(true);
        expect(textArea.value).toBe("```language\ncode\n```");
        expect(textArea.value.slice(textArea.selectionStart, textArea.selectionEnd)).toBe("language");

        expect(registry.executeCommand(EDITOR_COMMAND_IDS.codeBlock, context)).toBe(true);
        expect(textArea.value).toBe("code");
        expect([textArea.selectionStart, textArea.selectionEnd]).toEqual([0, 4]);

        textArea.setSelectionRange(2, 2);
        expect(registry.getCommand(EDITOR_COMMAND_IDS.codeBlock)?.isAvailable(context)).toBe(false);
        textArea.setSelectionRange(0, 4);
        textArea.readOnly = true;
        expect(registry.getCommand(EDITOR_COMMAND_IDS.codeBlock)?.isAvailable(context)).toBe(false);
    });

    test("inserts an editable URL placeholder for selected label text", () => {
        const registry = createCommandRegistry();
        const textArea = createTextArea("  docs  ", 0, 8);
        const context = { textArea };

        expect(registry.executeCommand(EDITOR_COMMAND_IDS.link, context)).toBe(true);
        expect(textArea.value).toBe("  [docs](url)  ");
        expect([textArea.selectionStart, textArea.selectionEnd]).toEqual([9, 12]);
    });

    test.each([
        "https://example.com/path",
        "http://example.com/path",
        "ftp://example.com/file",
        "mailto:user@example.com"
    ])("inserts an editable label placeholder for selected URL %s", (url) => {
        const registry = createCommandRegistry();
        const textArea = createTextArea(url, 0, url.length);
        const context = { textArea };

        expect(registry.executeCommand(EDITOR_COMMAND_IDS.link, context)).toBe(true);
        expect(textArea.value).toBe(`[link text](${url})`);
        expect([textArea.selectionStart, textArea.selectionEnd]).toEqual([1, 10]);
    });

    test("escapes a selected URL destination while preserving surrounding whitespace", () => {
        const registry = createCommandRegistry();
        const value = "  https://example.com/a_(b)<c>  ";
        const textArea = createTextArea(value, 0, value.length);
        const context = { textArea };

        expect(registry.executeCommand(EDITOR_COMMAND_IDS.link, context)).toBe(true);
        expect(textArea.value).toBe(String.raw`  [link text](https://example.com/a_\(b\)%3Cc%3E)  `);
        expect([textArea.selectionStart, textArea.selectionEnd]).toEqual([3, 12]);
    });

    test("executes line-prefix commands for collapsed selections", () => {
        const registry = createCommandRegistry();
        const textArea = createTextArea("title", 2, 2);
        const context = { textArea };

        expect(registry.getCommand(EDITOR_COMMAND_IDS.heading3)?.isAvailable(context)).toBe(true);
        expect(registry.executeCommand(EDITOR_COMMAND_IDS.heading3, context)).toBe(true);
        expect(textArea.value).toBe("### title");
        expect([textArea.selectionStart, textArea.selectionEnd]).toEqual([6, 6]);

        expect(registry.executeCommand(EDITOR_COMMAND_IDS.heading3, context)).toBe(true);
        expect(textArea.value).toBe("title");
        expect([textArea.selectionStart, textArea.selectionEnd]).toEqual([2, 2]);
    });

    test("applies shortcut overrides and configured bullet styles", () => {
        const registry = createCommandRegistry([], {
            bulletStyle: "+",
            shortcutOverrides: {
                bold: { key: "x", isPrimaryModifierRequired: true },
                italic: { key: "j", isPrimaryModifierRequired: true },
                link: { key: "l", isPrimaryModifierRequired: true }
            }
        });
        const textArea = createTextArea("value", 0, 5);
        const context = { textArea };

        expect(registry.findCommandByShortcut("b", true, context)).toBeUndefined();
        expect(registry.findCommandByShortcut("x", true, context)?.id).toBe(EDITOR_COMMAND_IDS.bold);
        expect(registry.findCommandByShortcut("j", true, context)?.id).toBe(EDITOR_COMMAND_IDS.italic);
        expect(registry.findCommandByShortcut("l", true, context)?.id).toBe(EDITOR_COMMAND_IDS.link);

        textArea.value = "item";
        textArea.setSelectionRange(0, 4);
        expect(registry.executeCommand(EDITOR_COMMAND_IDS.bulletList, context)).toBe(true);
        expect(textArea.value).toBe("+ item");
        textArea.value = "task";
        textArea.setSelectionRange(0, 4);
        expect(registry.executeCommand(EDITOR_COMMAND_IDS.taskList, context)).toBe(true);
        expect(textArea.value).toBe("+ [ ] task");
    });

    test("resolves shortcut conflicts with injected-command availability", () => {
        const isInjectedCommandAvailable = vi.fn(
            ({ textArea }: EditorCommandContext) => textArea.dataset.commandMode === "injected"
        );
        const executeInjectedCommand = vi.fn(() => true);
        const injectedCommand: EditorCommand = {
            id: "custom.bold",
            label: "Contextual bold",
            shortcut: { key: "b", isPrimaryModifierRequired: true },
            isAvailable: isInjectedCommandAvailable,
            execute: executeInjectedCommand
        };
        const registry = createCommandRegistry([injectedCommand]);
        const textArea = createTextArea("value", 0, 5);
        const context = { textArea };

        expect(registry.findCommandByShortcut("b", true, context)?.id).toBe(EDITOR_COMMAND_IDS.bold);
        textArea.dataset.commandMode = "injected";
        expect(registry.findCommandByShortcut("b", true, context)?.id).toBe(injectedCommand.id);
    });

    test("falls back when an injected shortcut command declines execution", () => {
        const executeInjectedCommand = vi.fn(() => false);
        const injectedCommand: EditorCommand = {
            id: "custom.bold",
            label: "Contextual bold",
            shortcut: { key: "b", isPrimaryModifierRequired: true },
            isAvailable: () => true,
            execute: executeInjectedCommand
        };
        const registry = createCommandRegistry([injectedCommand]);
        const textArea = createTextArea("value", 0, 5);
        const context = { textArea };

        expect(registry.executeCommandByShortcut("b", true, context)).toBe(true);
        expect(executeInjectedCommand).toHaveBeenCalledOnce();
        expect(textArea.value).toBe("**value**");
    });

    test("copies injected and override shortcut objects", () => {
        const injectedShortcut = { key: "e", isPrimaryModifierRequired: true };
        const boldOverride = { key: "x", isPrimaryModifierRequired: true as const };
        const injectedCommand: EditorCommand = {
            id: "custom.example",
            label: "Example",
            shortcut: injectedShortcut,
            isAvailable: () => true,
            execute: () => true
        };
        const registry = createCommandRegistry([injectedCommand], {
            shortcutOverrides: { bold: boldOverride }
        });
        const context: EditorCommandContext = { textArea: createTextArea("value", 0, 5) };

        expect(registry.getCommand(injectedCommand.id)).not.toBe(injectedCommand);
        expect(registry.getCommand(injectedCommand.id)?.shortcut).not.toBe(injectedShortcut);
        expect(registry.getCommand(EDITOR_COMMAND_IDS.bold)?.shortcut).not.toBe(boldOverride);

        injectedShortcut.key = "q";
        boldOverride.key = "z";
        expect(registry.findCommandByShortcut("e", true, context)?.id).toBe(injectedCommand.id);
        expect(registry.findCommandByShortcut("q", true, context)).toBeUndefined();
        expect(registry.findCommandByShortcut("x", true, context)?.id).toBe(EDITOR_COMMAND_IDS.bold);
        expect(registry.findCommandByShortcut("z", true, context)).toBeUndefined();
    });

    test("freezes command snapshots and captures source values only once", () => {
        let shortcutReads = 0;
        const sourceCommand = {
            id: "custom.snapshot",
            label: "Snapshot",
            get shortcut() {
                shortcutReads += 1;
                return { key: shortcutReads === 1 ? "e" : "q", isPrimaryModifierRequired: false };
            },
            isAvailable: () => true,
            execute: () => true
        };
        const registry = createCommandRegistry([sourceCommand]);
        const commands = registry.listCommands();
        const command = registry.getCommand("custom.snapshot");
        if (!command?.shortcut) {
            throw new Error("Expected snapshotted command shortcut");
        }

        expect(shortcutReads).toBe(1);
        expect(Object.isFrozen(commands)).toBe(true);
        expect(Object.isFrozen(command)).toBe(true);
        expect(Object.isFrozen(command.shortcut)).toBe(true);
        expect(() => (commands as EditorCommand[]).push(sourceCommand)).toThrow(TypeError);
        expect(() => ((command as { id: string }).id = "custom.changed")).toThrow(TypeError);
        expect(() => ((command.shortcut as { key: string }).key = "q")).toThrow(TypeError);

        sourceCommand.id = "custom.changed";
        sourceCommand.label = "Changed";
        sourceCommand.isAvailable = () => false;
        sourceCommand.execute = () => false;
        expect(registry.getCommand("custom.snapshot")?.label).toBe("Snapshot");
        expect(registry.getCommand("custom.changed")).toBeUndefined();
        expect(registry.findCommandByShortcut("e", false, { textArea: createTextArea("", 0, 0) })?.id).toBe(
            "custom.snapshot"
        );
        expect(shortcutReads).toBe(1);
    });

    test("binds prototype command methods to their original class instance", () => {
        class ClassCommand implements EditorCommand {
            readonly id = "custom.class";
            readonly label = "Class command";
            readonly shortcut = { key: "c", isPrimaryModifierRequired: false };
            isReady = true;
            executeCount = 0;

            isAvailable(): boolean {
                return this.isReady;
            }

            execute(): boolean {
                this.executeCount += 1;
                return this.isReady;
            }
        }

        const sourceCommand = new ClassCommand();
        const registry = createCommandRegistry([sourceCommand]);
        const context = { textArea: createTextArea("", 0, 0) };

        expect(registry.executeCommand("custom.class", context)).toBe(true);
        expect(sourceCommand.executeCount).toBe(1);
        sourceCommand.isReady = false;
        expect(registry.executeCommand("custom.class", context)).toBe(false);
        expect(sourceCommand.executeCount).toBe(1);
    });

    test("injects additional commands and rejects duplicate IDs", () => {
        const isInjectedCommandAvailable = vi.fn(() => true);
        const executeInjectedCommand = vi.fn(() => true);
        const injectedCommand: EditorCommand = {
            id: "custom.example",
            label: "Example",
            shortcut: { key: "e", isPrimaryModifierRequired: true },
            isAvailable: isInjectedCommandAvailable,
            execute: executeInjectedCommand
        };
        const registry = createCommandRegistry([injectedCommand]);
        const context: EditorCommandContext = { textArea: createTextArea("value", 0, 5) };

        expect(registry.findCommandByShortcut("E", true, context)?.id).toBe(injectedCommand.id);
        expect(registry.executeCommand(injectedCommand.id, context)).toBe(true);
        expect(isInjectedCommandAvailable).toHaveBeenCalledWith(context);
        expect(executeInjectedCommand).toHaveBeenCalledWith(context);
        expect(() => createCommandRegistry([injectedCommand, injectedCommand])).toThrow("Duplicate command ID");
    });
});
