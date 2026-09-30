import { afterEach, describe, expect, test, vi } from "vitest";
import type { EditorCommand } from "./command-registry";
import type { EditorAdapter } from "./editor-adapter";
import { initializeMarkdownEnhancer } from "./runtime";
import { createDefaultSettings, type MarkdownEnhancerSettings, type SettingsSource } from "./settings";

let disposeEnhancer: (() => void) | undefined;

const createAdapter = (
    id: string,
    isPageSupported: (url: URL) => boolean,
    isEditor: (element: Element) => element is HTMLTextAreaElement,
    commands: readonly EditorCommand[] = []
): EditorAdapter => ({
    id,
    capabilities: { isNativePreviewAvailable: false },
    commands,
    isPageSupported,
    isEditor
});

const createTextArea = (adapterId = "editor"): HTMLTextAreaElement => {
    const textArea = document.createElement("textarea");
    textArea.dataset.adapter = adapterId;
    document.body.append(textArea);
    return textArea;
};

const dispatchKey = (textArea: HTMLTextAreaElement, key: string, init: KeyboardEventInit = {}): KeyboardEvent => {
    const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, composed: true, key, ...init });
    textArea.dispatchEvent(event);
    return event;
};

const dispatchPaste = (textArea: HTMLTextAreaElement, text: string): Event => {
    const event = new Event("paste", { bubbles: true, cancelable: true, composed: true });
    Object.defineProperty(event, "clipboardData", {
        value: { getData: (type: string) => (type === "text" ? text : "") }
    });
    textArea.dispatchEvent(event);
    return event;
};

afterEach(() => {
    disposeEnhancer?.();
    disposeEnhancer = undefined;
    document.body.innerHTML = "";
    vi.restoreAllMocks();
});

describe("Markdown enhancer runtime", () => {
    test("reevaluates adapter activation after page URL changes", () => {
        let currentUrl = new URL("https://example.test/editor");
        const adapter = createAdapter(
            "dynamic",
            (url) => url.pathname === "/editor",
            (element): element is HTMLTextAreaElement => element instanceof HTMLTextAreaElement
        );
        const textArea = createTextArea();
        disposeEnhancer = initializeMarkdownEnhancer([], [adapter], () => currentUrl);

        textArea.value = "value";
        textArea.setSelectionRange(0, textArea.value.length);
        expect(dispatchKey(textArea, "(").defaultPrevented).toBe(true);

        currentUrl = new URL("https://example.test/excluded");
        textArea.value = "value";
        textArea.setSelectionRange(0, textArea.value.length);
        expect(dispatchKey(textArea, "(").defaultPrevented).toBe(false);
        expect(textArea.value).toBe("value");

        currentUrl = new URL("https://example.test/editor");
        expect(dispatchKey(textArea, "(").defaultPrevented).toBe(true);
    });

    test("snapshots adapters and accepts URL objects from another realm", () => {
        const createScopedAdapter = (id: string): EditorAdapter =>
            createAdapter(
                id,
                (url) => url.pathname === "/editor",
                (element): element is HTMLTextAreaElement =>
                    element instanceof HTMLTextAreaElement && element.dataset.adapter === id
            );
        const adapters: EditorAdapter[] = [createScopedAdapter("configured")];
        const iframe = document.createElement("iframe");
        document.body.append(iframe);
        const ForeignUrl = (iframe.contentWindow as unknown as { readonly URL?: typeof URL } | null)?.URL;
        if (!ForeignUrl) {
            throw new Error("Expected iframe URL constructor");
        }
        const pageUrl = new ForeignUrl("https://example.test/editor");
        disposeEnhancer = initializeMarkdownEnhancer([], adapters, pageUrl);
        adapters.push(createScopedAdapter("added-later"));

        const configuredEditor = createTextArea("configured");
        configuredEditor.value = "configured";
        configuredEditor.setSelectionRange(0, configuredEditor.value.length);
        expect(dispatchKey(configuredEditor, "(").defaultPrevented).toBe(true);

        const addedEditor = createTextArea("added-later");
        addedEditor.value = "added";
        addedEditor.setSelectionRange(0, addedEditor.value.length);
        expect(dispatchKey(addedEditor, "(").defaultPrevented).toBe(false);
        expect(addedEditor.value).toBe("added");
    });

    test("snapshots additional commands and each adapter command collection", () => {
        const createShortcutCommand = (id: string, key: string, execute: () => boolean): EditorCommand => ({
            id,
            label: id,
            shortcut: { key, isPrimaryModifierRequired: false },
            isAvailable: () => true,
            execute
        });
        const executeAdditional = vi.fn(() => true);
        const executeFirstAdapter = vi.fn(() => true);
        const executeSecondAdapter = vi.fn(() => true);
        const executeAddedLater = vi.fn(() => true);
        const additionalCommands = [createShortcutCommand("additional.initial", "x", executeAdditional)];
        const firstAdapterCommands = [createShortcutCommand("first.initial", "y", executeFirstAdapter)];
        const secondAdapterCommands = [createShortcutCommand("second.initial", "q", executeSecondAdapter)];
        const adapters = [
            createAdapter(
                "first",
                () => true,
                (element): element is HTMLTextAreaElement =>
                    element instanceof HTMLTextAreaElement && element.dataset.adapter === "first",
                firstAdapterCommands
            ),
            createAdapter(
                "second",
                () => true,
                (element): element is HTMLTextAreaElement =>
                    element instanceof HTMLTextAreaElement && element.dataset.adapter === "second",
                secondAdapterCommands
            )
        ];
        disposeEnhancer = initializeMarkdownEnhancer(
            additionalCommands,
            adapters,
            new URL("https://example.test/editor")
        );

        additionalCommands.splice(0, 1, createShortcutCommand("additional.late", "z", executeAddedLater));
        firstAdapterCommands.splice(0, 1, createShortcutCommand("first.late", "w", executeAddedLater));
        secondAdapterCommands.push(createShortcutCommand("second.late", "r", executeAddedLater));

        const firstEditor = createTextArea("first");
        expect(dispatchKey(firstEditor, "x").defaultPrevented).toBe(true);
        expect(dispatchKey(firstEditor, "y").defaultPrevented).toBe(true);
        expect(dispatchKey(firstEditor, "z").defaultPrevented).toBe(false);
        expect(dispatchKey(firstEditor, "w").defaultPrevented).toBe(false);

        const secondEditor = createTextArea("second");
        expect(dispatchKey(secondEditor, "q").defaultPrevented).toBe(true);
        expect(dispatchKey(secondEditor, "r").defaultPrevented).toBe(false);
        expect(executeAdditional).toHaveBeenCalledOnce();
        expect(executeFirstAdapter).toHaveBeenCalledOnce();
        expect(executeSecondAdapter).toHaveBeenCalledOnce();
        expect(executeAddedLater).not.toHaveBeenCalled();
    });

    test("captures command object values before later source mutation", () => {
        const executeOriginal = vi.fn(() => true);
        const executeReplacement = vi.fn(() => true);
        const sourceCommand = {
            id: "additional.original",
            label: "Original",
            shortcut: { key: "x", isPrimaryModifierRequired: false },
            isAvailable: () => true,
            execute: executeOriginal
        };
        const adapter = createAdapter(
            "mutable-command",
            () => true,
            (element): element is HTMLTextAreaElement => element instanceof HTMLTextAreaElement
        );
        disposeEnhancer = initializeMarkdownEnhancer(
            [sourceCommand],
            [adapter],
            new URL("https://example.test/editor")
        );

        sourceCommand.id = "additional.changed";
        sourceCommand.label = "Changed";
        sourceCommand.shortcut.key = "z";
        sourceCommand.isAvailable = () => false;
        sourceCommand.execute = executeReplacement;

        const textArea = createTextArea();
        expect(dispatchKey(textArea, "x").defaultPrevented).toBe(true);
        expect(dispatchKey(textArea, "z").defaultPrevented).toBe(false);
        expect(executeOriginal).toHaveBeenCalledOnce();
        expect(executeReplacement).not.toHaveBeenCalled();
    });

    test("captures adapter getters once and binds class adapter and command methods", () => {
        class ClassCommand implements EditorCommand {
            readonly id = "class.command";
            readonly label = "Class command";
            readonly shortcut = { key: "c", isPrimaryModifierRequired: false };
            executeCount = 0;

            isAvailable({ textArea }: { textArea: HTMLTextAreaElement }): boolean {
                return textArea.dataset.adapter === "class-adapter";
            }

            execute(): boolean {
                this.executeCount += 1;
                return true;
            }
        }

        class ClassAdapter implements EditorAdapter {
            readonly id = "class-adapter";
            readonly capabilities = { isNativePreviewAvailable: false };
            commandReads = 0;
            readonly command = new ClassCommand();

            get commands(): readonly EditorCommand[] {
                this.commandReads += 1;
                return this.commandReads === 1 ? [this.command] : [this.command, this.command];
            }

            isPageSupported(url: URL): boolean {
                return url.pathname === "/editor";
            }

            isEditor(element: Element): element is HTMLTextAreaElement {
                return element instanceof HTMLTextAreaElement && element.dataset.adapter === this.id;
            }
        }

        const sourceAdapter = new ClassAdapter();
        disposeEnhancer = initializeMarkdownEnhancer([], [sourceAdapter], new URL("https://example.test/editor"));
        const textArea = createTextArea("class-adapter");

        expect(sourceAdapter.commandReads).toBe(1);
        expect(dispatchKey(textArea, "c").defaultPrevented).toBe(true);
        expect(sourceAdapter.command.executeCount).toBe(1);
        expect(sourceAdapter.commandReads).toBe(1);
    });

    test("scopes contributed commands to the adapter that resolved the editor", () => {
        const executeFirstCommand = vi.fn(() => true);
        const executeSecondCommand = vi.fn(() => true);
        const createCommand = (execute: () => boolean): EditorCommand => ({
            id: "adapter.action",
            label: "Adapter action",
            shortcut: { key: "x", isPrimaryModifierRequired: false },
            isAvailable: () => true,
            execute
        });
        const createScopedAdapter = (id: string, command: EditorCommand): EditorAdapter =>
            createAdapter(
                id,
                () => true,
                (element): element is HTMLTextAreaElement =>
                    element instanceof HTMLTextAreaElement && element.dataset.adapter === id,
                [command]
            );
        const firstEditor = createTextArea("first");
        const secondEditor = createTextArea("second");
        disposeEnhancer = initializeMarkdownEnhancer(
            [],
            [
                createScopedAdapter("first", createCommand(executeFirstCommand)),
                createScopedAdapter("second", createCommand(executeSecondCommand))
            ],
            new URL("https://example.test/editor")
        );

        dispatchKey(firstEditor, "x");
        expect(executeFirstCommand).toHaveBeenCalledOnce();
        expect(executeSecondCommand).not.toHaveBeenCalled();

        dispatchKey(secondEditor, "x");
        expect(executeSecondCommand).toHaveBeenCalledOnce();
        expect(executeFirstCommand).toHaveBeenCalledOnce();
    });

    test("validates adapter command IDs before attaching listeners", () => {
        const duplicateCommand: EditorCommand = {
            id: "duplicate.action",
            label: "Duplicate action",
            isAvailable: () => true,
            execute: () => true
        };
        const adapter = createAdapter(
            "invalid",
            () => true,
            (element): element is HTMLTextAreaElement => element instanceof HTMLTextAreaElement,
            [duplicateCommand, duplicateCommand]
        );
        const textArea = createTextArea();

        expect(() => initializeMarkdownEnhancer([], [adapter], new URL("https://example.test/editor"))).toThrow(
            "Duplicate command ID"
        );
        textArea.value = "value";
        textArea.setSelectionRange(0, textArea.value.length);
        expect(dispatchKey(textArea, "(").defaultPrevented).toBe(false);
        expect(textArea.value).toBe("value");
    });

    test("defers to composing and page-consumed editor events", () => {
        const adapter = createAdapter(
            "deferred",
            () => true,
            (element): element is HTMLTextAreaElement => element instanceof HTMLTextAreaElement
        );
        const textArea = createTextArea();
        disposeEnhancer = initializeMarkdownEnhancer([], [adapter], new URL("https://example.test/editor"));

        textArea.value = "- item";
        textArea.setSelectionRange(textArea.value.length, textArea.value.length);
        expect(dispatchKey(textArea, "Enter", { isComposing: true }).defaultPrevented).toBe(false);
        expect(textArea.value).toBe("- item");

        textArea.addEventListener("keydown", (event) => event.preventDefault(), { once: true });
        expect(dispatchKey(textArea, "Enter").defaultPrevented).toBe(true);
        expect(textArea.value).toBe("- item");

        textArea.value = "label";
        textArea.setSelectionRange(0, textArea.value.length);
        textArea.addEventListener("paste", (event) => event.preventDefault(), { once: true });
        expect(dispatchPaste(textArea, "https://example.test").defaultPrevented).toBe(true);
        expect(textArea.value).toBe("label");
    });

    test("dispatches requested change events only after text edits", () => {
        const adapter: EditorAdapter = {
            ...createAdapter(
                "change-aware",
                () => true,
                (element): element is HTMLTextAreaElement => element instanceof HTMLTextAreaElement
            ),
            shouldDispatchChangeEventAfterEdit: true
        };
        const textArea = createTextArea();
        const changeEvents: Event[] = [];
        textArea.addEventListener("change", (event) => changeEvents.push(event));
        disposeEnhancer = initializeMarkdownEnhancer([], [adapter], new URL("https://example.test/editor"));

        textArea.value = "value";
        textArea.setSelectionRange(0, textArea.value.length);
        dispatchKey(textArea, "(");
        expect(changeEvents).toHaveLength(1);

        textArea.value = "()";
        textArea.setSelectionRange(1, 1);
        dispatchKey(textArea, ")");
        expect(changeEvents).toHaveLength(1);
    });

    test("applies live settings on every event without reload", () => {
        vi.spyOn(navigator, "userAgent", "get").mockReturnValue("Mozilla/5.0 (X11; Linux x86_64)");
        let settings: MarkdownEnhancerSettings = { ...createDefaultSettings(), isEnabled: false };
        const settingsSource: SettingsSource = { getSettings: () => settings };
        const textArea = createTextArea();
        disposeEnhancer = initializeMarkdownEnhancer(
            [],
            undefined,
            new URL("https://example.test/editor"),
            settingsSource
        );

        textArea.value = "value";
        textArea.setSelectionRange(0, 5);
        expect(dispatchKey(textArea, "(").defaultPrevented).toBe(false);

        settings = { ...settings, isEnabled: true, tabWidth: 2 };
        textArea.value = "a";
        textArea.setSelectionRange(1, 1);
        expect(dispatchKey(textArea, "Tab").defaultPrevented).toBe(true);
        expect(textArea.value).toBe("a ");

        settings = {
            ...settings,
            shortcutOverrides: { bold: { key: "x", isPrimaryModifierRequired: true } }
        };
        textArea.value = "value";
        textArea.setSelectionRange(0, 5);
        expect(dispatchKey(textArea, "b", { ctrlKey: true }).defaultPrevented).toBe(false);
        expect(dispatchKey(textArea, "x", { ctrlKey: true }).defaultPrevented).toBe(true);
        expect(textArea.value).toBe("**value**");

        settings = { ...settings, excludedEditorSelectors: ["[", "textarea"] };
        textArea.value = "value";
        textArea.setSelectionRange(0, 5);
        expect(dispatchKey(textArea, "(").defaultPrevented).toBe(false);

        settings = { ...settings, excludedEditorSelectors: ["["] };
        expect(dispatchKey(textArea, "(").defaultPrevented).toBe(true);

        settings = { ...settings, excludedHostnames: ["example.test"] };
        textArea.value = "value";
        textArea.setSelectionRange(0, 5);
        expect(dispatchKey(textArea, "(").defaultPrevented).toBe(false);
    });

    test("disposes delegated keyboard and paste listeners", () => {
        const adapter = createAdapter(
            "disposable",
            () => true,
            (element): element is HTMLTextAreaElement => element instanceof HTMLTextAreaElement
        );
        const textArea = createTextArea();
        const dispose = initializeMarkdownEnhancer([], [adapter], new URL("https://example.test/editor"));
        dispose();

        textArea.value = "label";
        textArea.setSelectionRange(0, textArea.value.length);
        expect(dispatchKey(textArea, "(").defaultPrevented).toBe(false);
        expect(dispatchPaste(textArea, "https://example.test").defaultPrevented).toBe(false);
        expect(textArea.value).toBe("label");
    });
});
