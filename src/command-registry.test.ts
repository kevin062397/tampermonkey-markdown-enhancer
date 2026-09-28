import { afterEach, describe, expect, test, vi } from "vitest";
import {
    createCommandRegistry,
    FORMAT_COMMAND_IDS,
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
            { id: FORMAT_COMMAND_IDS.bold, label: "Bold" },
            { id: FORMAT_COMMAND_IDS.italic, label: "Italic" },
            { id: FORMAT_COMMAND_IDS.strikethrough, label: "Strikethrough" },
            { id: FORMAT_COMMAND_IDS.inlineCode, label: "Inline code" }
        ]);
        expect(registry.findCommandByShortcut("B", true, context)?.id).toBe(FORMAT_COMMAND_IDS.bold);
        expect(registry.findCommandByShortcut("i", true, context)?.id).toBe(FORMAT_COMMAND_IDS.italic);
        expect(registry.findCommandByShortcut("b", false, context)).toBeUndefined();
    });

    test("makes formatting unavailable for empty or whitespace-only selections", () => {
        const registry = createCommandRegistry();
        const textArea = createTextArea("   ", 0, 3);
        const context = { textArea };

        expect(registry.getCommand(FORMAT_COMMAND_IDS.bold)?.isAvailable(context)).toBe(false);
        expect(registry.executeCommand(FORMAT_COMMAND_IDS.bold, context)).toBe(false);
        expect(textArea.value).toBe("   ");

        textArea.value = "value";
        textArea.setSelectionRange(0, 5);
        textArea.readOnly = true;
        expect(registry.getCommand(FORMAT_COMMAND_IDS.bold)?.isAvailable(context)).toBe(false);
        textArea.readOnly = false;
        textArea.disabled = true;
        expect(registry.getCommand(FORMAT_COMMAND_IDS.bold)?.isAvailable(context)).toBe(false);
    });

    test("preserves bold while toggling italic for marker-inclusive selections", () => {
        const registry = createCommandRegistry();
        const textArea = createTextArea("**hello**", 0, 9);
        const context = { textArea };

        expect(registry.executeCommand(FORMAT_COMMAND_IDS.italic, context)).toBe(true);
        expect(textArea.value).toBe("***hello***");
        expect([textArea.selectionStart, textArea.selectionEnd]).toEqual([3, 8]);

        expect(registry.executeCommand(FORMAT_COMMAND_IDS.italic, context)).toBe(true);
        expect(textArea.value).toBe("**hello**");
        expect([textArea.selectionStart, textArea.selectionEnd]).toEqual([2, 7]);
    });

    test("toggles split asterisk layers as combined formatting", () => {
        const registry = createCommandRegistry();
        const textArea = createTextArea("***hello***", 2, 9);
        const context = { textArea };

        expect(registry.executeCommand(FORMAT_COMMAND_IDS.italic, context)).toBe(true);
        expect(textArea.value).toBe("**hello**");
        expect([textArea.selectionStart, textArea.selectionEnd]).toEqual([2, 7]);

        textArea.value = "***hello***";
        textArea.setSelectionRange(1, 10);
        expect(registry.executeCommand(FORMAT_COMMAND_IDS.bold, context)).toBe(true);
        expect(textArea.value).toBe("*hello*");
        expect([textArea.selectionStart, textArea.selectionEnd]).toEqual([1, 6]);

        textArea.value = "**hello**";
        textArea.setSelectionRange(1, 8);
        expect(registry.executeCommand(FORMAT_COMMAND_IDS.italic, context)).toBe(true);
        expect(textArea.value).toBe("***hello***");
        expect([textArea.selectionStart, textArea.selectionEnd]).toEqual([3, 8]);

        textArea.value = "****hello****";
        textArea.setSelectionRange(2, 11);
        expect(registry.executeCommand(FORMAT_COMMAND_IDS.bold, context)).toBe(true);
        expect(textArea.value).toBe("**hello**");
        expect([textArea.selectionStart, textArea.selectionEnd]).toEqual([2, 7]);
    });

    test("toggles strikethrough outside content while preserving surrounding whitespace", () => {
        const registry = createCommandRegistry();
        const textArea = createTextArea("  hello  ", 0, 9);
        const context = { textArea };

        expect(registry.executeCommand(FORMAT_COMMAND_IDS.strikethrough, context)).toBe(true);
        expect(textArea.value).toBe("  ~~hello~~  ");
        expect([textArea.selectionStart, textArea.selectionEnd]).toEqual([4, 9]);

        expect(registry.executeCommand(FORMAT_COMMAND_IDS.strikethrough, context)).toBe(true);
        expect(textArea.value).toBe("  hello  ");
        expect([textArea.selectionStart, textArea.selectionEnd]).toEqual([2, 7]);
    });

    test("toggles inline-code markers included inside a whitespace-padded selection", () => {
        const registry = createCommandRegistry();
        const textArea = createTextArea("  `hello`  ", 0, 11);
        const context = { textArea };

        expect(registry.executeCommand(FORMAT_COMMAND_IDS.inlineCode, context)).toBe(true);
        expect(textArea.value).toBe("  hello  ");
        expect([textArea.selectionStart, textArea.selectionEnd]).toEqual([2, 7]);

        expect(registry.executeCommand(FORMAT_COMMAND_IDS.inlineCode, context)).toBe(true);
        expect(textArea.value).toBe("  `hello`  ");
        expect([textArea.selectionStart, textArea.selectionEnd]).toEqual([3, 8]);
    });

    test("removes external markers around whitespace-padded content", () => {
        const registry = createCommandRegistry();
        const textArea = createTextArea("~~  hello  ~~", 2, 11);
        const context = { textArea };

        expect(registry.executeCommand(FORMAT_COMMAND_IDS.strikethrough, context)).toBe(true);
        expect(textArea.value).toBe("  hello  ");
        expect([textArea.selectionStart, textArea.selectionEnd]).toEqual([2, 7]);

        textArea.value = "`  hello  `";
        textArea.setSelectionRange(1, 10);
        expect(registry.executeCommand(FORMAT_COMMAND_IDS.inlineCode, context)).toBe(true);
        expect(textArea.value).toBe("  hello  ");
        expect([textArea.selectionStart, textArea.selectionEnd]).toEqual([2, 7]);

        textArea.value = "~~hello~~";
        textArea.setSelectionRange(1, 8);
        expect(registry.executeCommand(FORMAT_COMMAND_IDS.strikethrough, context)).toBe(true);
        expect(textArea.value).toBe("hello");
        expect([textArea.selectionStart, textArea.selectionEnd]).toEqual([0, 5]);

        textArea.value = "``hello``";
        textArea.setSelectionRange(1, 8);
        expect(registry.executeCommand(FORMAT_COMMAND_IDS.inlineCode, context)).toBe(true);
        expect(textArea.value).toBe("hello");
        expect([textArea.selectionStart, textArea.selectionEnd]).toEqual([0, 5]);
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

        expect(registry.findCommandByShortcut("b", true, context)?.id).toBe(FORMAT_COMMAND_IDS.bold);
        textArea.dataset.commandMode = "injected";
        expect(registry.findCommandByShortcut("b", true, context)).toBe(injectedCommand);
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

        expect(registry.findCommandByShortcut("E", true, context)).toBe(injectedCommand);
        expect(registry.executeCommand(injectedCommand.id, context)).toBe(true);
        expect(isInjectedCommandAvailable).toHaveBeenCalledWith(context);
        expect(executeInjectedCommand).toHaveBeenCalledWith(context);
        expect(() => createCommandRegistry([injectedCommand, injectedCommand])).toThrow("Duplicate command ID");
    });
});
