import { afterEach, describe, expect, test, vi } from "vitest";
import type { EditorCommand } from "./command-registry";
import type { EditorAdapter } from "./editor-adapter";
import { initializeMarkdownEnhancer } from "./runtime";

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

const dispatchKey = (textArea: HTMLTextAreaElement, key: string): KeyboardEvent => {
    const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, composed: true, key });
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
