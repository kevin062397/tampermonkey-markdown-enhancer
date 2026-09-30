import { afterEach, describe, expect, test, vi } from "vitest";
import { createCommandRegistry, EDITOR_COMMAND_IDS, type EditorCommandRegistry } from "./command-registry";
import {
    attachFormattingToolbar,
    type FormattingToolbarEditor,
    type FormattingToolbarOptions
} from "./formatting-toolbar";

const TOOLBAR_SELECTOR = "[data-tampermonkey-markdown-enhancer-formatting-toolbar]";
const PRIMARY_COMMAND_IDS = new Set<string>([
    EDITOR_COMMAND_IDS.bold,
    EDITOR_COMMAND_IDS.italic,
    EDITOR_COMMAND_IDS.strikethrough,
    EDITOR_COMMAND_IDS.inlineCode,
    EDITOR_COMMAND_IDS.link
]);

interface ToolbarFixture {
    readonly registry: EditorCommandRegistry;
    readonly dispose: () => void;
    readonly getToolbar: () => HTMLElement | null;
    readonly setEnabled: (isEnabled: boolean) => void;
}

const createTextArea = (placement: "before-editor" | "after-editor" = "after-editor"): HTMLTextAreaElement => {
    const textArea = document.createElement("textarea");
    textArea.dataset.toolbarPlacement = placement;
    textArea.dataset.isSupportedEditor = "true";
    document.body.append(textArea);
    return textArea;
};

const resolveFixtureEditor = (
    textArea: HTMLTextAreaElement,
    registry: EditorCommandRegistry,
    isEnabled: boolean
): FormattingToolbarEditor | null => {
    if (!isEnabled || !textArea.isConnected || textArea.dataset.isSupportedEditor !== "true") {
        return null;
    }
    return {
        textArea,
        commandRegistry: registry,
        toolbarPlacement: textArea.dataset.toolbarPlacement === "before-editor" ? "before-editor" : "after-editor",
        shouldDispatchChangeEventAfterEdit: textArea.dataset.shouldDispatchChange === "true"
    };
};

const createFixture = (registry: EditorCommandRegistry = createCommandRegistry()): ToolbarFixture => {
    let isEnabled = true;
    const listeners = new Set<() => void>();
    const resolveEditorFromTextArea = (textArea: HTMLTextAreaElement): FormattingToolbarEditor | null =>
        resolveFixtureEditor(textArea, registry, isEnabled);
    const options: FormattingToolbarOptions = {
        resolveEditor: (event) => {
            const textArea = event
                .composedPath()
                .find((target): target is HTMLTextAreaElement => target instanceof HTMLTextAreaElement);
            return textArea ? resolveEditorFromTextArea(textArea) : null;
        },
        resolveEditorFromTextArea,
        subscribeSettings: (listener) => {
            listeners.add(listener);
            return () => listeners.delete(listener);
        }
    };
    return {
        registry,
        dispose: attachFormattingToolbar(options),
        getToolbar: () => document.querySelector<HTMLElement>(TOOLBAR_SELECTOR),
        setEnabled: (nextIsEnabled) => {
            isEnabled = nextIsEnabled;
            for (const listener of listeners) {
                listener();
            }
        }
    };
};

const dispatchKeyboardEvent = (target: EventTarget, key: string, init: KeyboardEventInit = {}): KeyboardEvent => {
    const event = new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        composed: true,
        key,
        ...init
    });
    target.dispatchEvent(event);
    return event;
};

const dispatchMouseActivation = (button: HTMLButtonElement): MouseEvent => {
    const event = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    button.dispatchEvent(event);
    button.click();
    return event;
};

const flushMutationObserver = async (): Promise<void> => {
    await new Promise((resolve) => setTimeout(resolve, 0));
};

const getCommandButton = (toolbar: HTMLElement, commandId: string): HTMLButtonElement => {
    const button = toolbar.querySelector<HTMLButtonElement>(`button[data-command-id="${commandId}"]`);
    if (!button) {
        throw new Error(`Missing toolbar command: ${commandId}`);
    }
    return button;
};

const getOverflowTrigger = (toolbar: HTMLElement): HTMLButtonElement => {
    const button = toolbar.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]');
    if (!button) {
        throw new Error("Missing overflow trigger");
    }
    return button;
};

let fixture: ToolbarFixture | undefined;

afterEach(() => {
    fixture?.dispose();
    fixture = undefined;
    document.body.innerHTML = "";
    vi.restoreAllMocks();
});

describe("Formatting toolbar", () => {
    test("executes primary commands exclusively through the registry while preserving selection and focus", () => {
        const registry = createCommandRegistry();
        const executeCommand = vi.spyOn(registry, "executeCommand");
        fixture = createFixture(registry);
        const textArea = createTextArea();
        textArea.value = "selected";
        textArea.setSelectionRange(0, textArea.value.length);
        textArea.focus();
        const toolbar = fixture.getToolbar();
        if (!toolbar) {
            throw new Error("Expected toolbar");
        }

        const boldButton = getCommandButton(toolbar, EDITOR_COMMAND_IDS.bold);
        const mouseEvent = dispatchMouseActivation(boldButton);

        expect(mouseEvent.defaultPrevented).toBe(true);
        expect(executeCommand).toHaveBeenCalledWith(EDITOR_COMMAND_IDS.bold, { textArea });
        expect(textArea.value).toBe("**selected**");
        expect([textArea.selectionStart, textArea.selectionEnd]).toEqual([2, 10]);
        expect(document.activeElement).toBe(textArea);
    });

    test("places one container around the active editor and relocates that same container", () => {
        fixture = createFixture();
        const firstEditor = createTextArea("after-editor");
        const secondEditor = createTextArea("before-editor");
        firstEditor.focus();
        const toolbar = fixture.getToolbar();
        if (!toolbar) {
            throw new Error("Expected toolbar");
        }

        expect(firstEditor.nextSibling).toBe(toolbar);
        firstEditor.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
        expect(document.querySelectorAll(TOOLBAR_SELECTOR)).toHaveLength(1);
        expect(fixture.getToolbar()).toBe(toolbar);

        secondEditor.focus();
        expect(secondEditor.previousSibling).toBe(toolbar);
        expect(fixture.getToolbar()).toBe(toolbar);
        expect(document.querySelectorAll(TOOLBAR_SELECTOR)).toHaveLength(1);
    });

    test("refreshes command availability on selection, input, and key events", async () => {
        fixture = createFixture();
        const textArea = createTextArea();
        textArea.value = "value";
        textArea.setSelectionRange(0, 0);
        textArea.focus();
        const toolbar = fixture.getToolbar();
        if (!toolbar) {
            throw new Error("Expected toolbar");
        }
        const boldButton = getCommandButton(toolbar, EDITOR_COMMAND_IDS.bold);
        expect(boldButton.disabled).toBe(true);

        textArea.setSelectionRange(0, 5);
        textArea.dispatchEvent(new Event("select", { bubbles: true }));
        await Promise.resolve();
        expect(boldButton.disabled).toBe(false);

        textArea.value = "";
        textArea.setSelectionRange(0, 0);
        textArea.dispatchEvent(new InputEvent("input", { bubbles: true }));
        await Promise.resolve();
        expect(boldButton.disabled).toBe(true);

        textArea.value = "again";
        textArea.setSelectionRange(0, 5);
        textArea.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, key: "n" }));
        await Promise.resolve();
        expect(boldButton.disabled).toBe(false);
    });

    test("exposes accessible controls and handles Alt+F10 only for the active supported editor", () => {
        fixture = createFixture();
        const textArea = createTextArea();
        textArea.value = "value";
        textArea.setSelectionRange(0, 5);
        textArea.focus();
        const toolbar = fixture.getToolbar();
        if (!toolbar) {
            throw new Error("Expected toolbar");
        }

        expect(toolbar.getAttribute("role")).toBe("toolbar");
        expect(toolbar.getAttribute("aria-label")).toBe("Markdown formatting");
        expect(
            toolbar.querySelector("style[data-tampermonkey-markdown-enhancer-formatting-toolbar-style]")
        ).not.toBeNull();
        const boldButton = getCommandButton(toolbar, EDITOR_COMMAND_IDS.bold);
        expect(boldButton.title).toBe("Bold");
        expect(boldButton.getAttribute("aria-label")).toBe("Bold");

        const pageKeydown = vi.fn();
        document.addEventListener("keydown", pageKeydown);
        const shortcutEvent = dispatchKeyboardEvent(textArea, "F10", { altKey: true });
        document.removeEventListener("keydown", pageKeydown);
        expect(shortcutEvent.defaultPrevented).toBe(true);
        expect(pageKeydown).not.toHaveBeenCalled();
        expect(document.activeElement).toBe(boldButton);

        const pageInput = document.createElement("input");
        document.body.append(pageInput);
        const unrelatedEvent = dispatchKeyboardEvent(pageInput, "F10", { altKey: true });
        expect(unrelatedEvent.defaultPrevented).toBe(false);
        expect(dispatchKeyboardEvent(pageInput, "ArrowRight").defaultPrevented).toBe(false);
    });

    test("derives overflow commands from the registry and supports keyboard navigation and Escape", () => {
        const executeCustomCommand = vi.fn(() => true);
        const registry = createCommandRegistry([
            {
                id: "custom.action",
                label: "Custom action",
                isAvailable: () => true,
                execute: executeCustomCommand
            }
        ]);
        fixture = createFixture(registry);
        const textArea = createTextArea();
        textArea.value = "value";
        textArea.setSelectionRange(0, 5);
        textArea.focus();
        const toolbar = fixture.getToolbar();
        if (!toolbar) {
            throw new Error("Expected toolbar");
        }
        const trigger = getOverflowTrigger(toolbar);
        const panel = toolbar.querySelector<HTMLElement>('[role="menu"]');
        if (!panel) {
            throw new Error("Expected overflow panel");
        }

        const overflowIds = Array.from(
            panel.querySelectorAll<HTMLButtonElement>("button[data-command-id]"),
            (button) => button.dataset.commandId
        );
        expect(overflowIds).toEqual(
            registry
                .listCommands()
                .filter(({ id }) => !PRIMARY_COMMAND_IDS.has(id))
                .map(({ id }) => id)
        );
        expect(panel.hidden).toBe(true);
        expect(trigger.getAttribute("aria-expanded")).toBe("false");

        trigger.focus();
        expect(dispatchKeyboardEvent(trigger, "ArrowDown").defaultPrevented).toBe(true);
        expect(panel.hidden).toBe(false);
        expect(trigger.getAttribute("aria-expanded")).toBe("true");
        const enabledOverflowButtons = Array.from(panel.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"));
        expect(document.activeElement).toBe(enabledOverflowButtons[0]);
        dispatchKeyboardEvent(enabledOverflowButtons[0], "ArrowDown");
        expect(document.activeElement).toBe(enabledOverflowButtons[1]);
        expect(dispatchKeyboardEvent(enabledOverflowButtons[1], "Escape").defaultPrevented).toBe(true);
        expect(panel.hidden).toBe(true);
        expect(document.activeElement).toBe(trigger);
    });

    test("dispatches composed change events only for requested value changes", () => {
        fixture = createFixture();
        const textArea = createTextArea();
        textArea.dataset.shouldDispatchChange = "true";
        textArea.value = "value";
        textArea.setSelectionRange(0, 5);
        const changeEvents: Event[] = [];
        textArea.addEventListener("change", (event) => changeEvents.push(event));
        textArea.focus();
        const toolbar = fixture.getToolbar();
        if (!toolbar) {
            throw new Error("Expected toolbar");
        }

        dispatchMouseActivation(getCommandButton(toolbar, EDITOR_COMMAND_IDS.bold));
        expect(changeEvents).toHaveLength(1);
        expect(changeEvents[0].bubbles).toBe(true);
        expect(changeEvents[0].composed).toBe(true);

        textArea.value = "";
        textArea.setSelectionRange(0, 0);
        textArea.dispatchEvent(new Event("select", { bubbles: true }));
        getCommandButton(toolbar, EDITOR_COMMAND_IDS.bold).click();
        expect(changeEvents).toHaveLength(1);

        const secondEditor = createTextArea();
        secondEditor.value = "plain";
        secondEditor.setSelectionRange(0, 5);
        const secondChange = vi.fn();
        secondEditor.addEventListener("change", secondChange);
        secondEditor.focus();
        dispatchMouseActivation(getCommandButton(toolbar, EDITOR_COMMAND_IDS.italic));
        expect(secondEditor.value).toBe("*plain*");
        expect(secondChange).not.toHaveBeenCalled();
    });

    test("removes the toolbar immediately when settings disable it and recreates it on later focus", () => {
        fixture = createFixture();
        const textArea = createTextArea();
        textArea.focus();
        expect(fixture.getToolbar()).not.toBeNull();

        fixture.setEnabled(false);
        expect(fixture.getToolbar()).toBeNull();
        textArea.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
        expect(fixture.getToolbar()).toBeNull();

        fixture.setEnabled(true);
        textArea.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
        expect(fixture.getToolbar()).not.toBeNull();
    });

    test("cleans the active container after editor removal and relocates after remount", async () => {
        fixture = createFixture();
        const textArea = createTextArea();
        textArea.focus();
        expect(fixture.getToolbar()).not.toBeNull();

        textArea.remove();
        await flushMutationObserver();
        expect(fixture.getToolbar()).toBeNull();

        const remountedEditor = createTextArea();
        remountedEditor.focus();
        expect(fixture.getToolbar()).not.toBeNull();
        expect(remountedEditor.nextSibling).toBe(fixture.getToolbar());
    });

    test("tracks selection, keyboard navigation, and removal inside an open ShadowRoot", async () => {
        fixture = createFixture();
        const host = document.createElement("div");
        const shadowRoot = host.attachShadow({ mode: "open" });
        const textArea = document.createElement("textarea");
        textArea.dataset.toolbarPlacement = "after-editor";
        textArea.dataset.isSupportedEditor = "true";
        textArea.value = "value";
        textArea.setSelectionRange(0, 0);
        shadowRoot.append(textArea);
        document.body.append(host);
        textArea.focus();
        const toolbar = shadowRoot.querySelector<HTMLElement>(TOOLBAR_SELECTOR);
        if (!toolbar) {
            throw new Error("Expected toolbar inside ShadowRoot");
        }
        const boldButton = getCommandButton(toolbar, EDITOR_COMMAND_IDS.bold);
        expect(boldButton.disabled).toBe(true);

        textArea.setSelectionRange(0, textArea.value.length);
        document.dispatchEvent(new Event("selectionchange"));
        await Promise.resolve();
        expect(boldButton.disabled).toBe(false);

        boldButton.focus();
        expect(dispatchKeyboardEvent(boldButton, "ArrowRight").defaultPrevented).toBe(true);
        expect(shadowRoot.activeElement).toBe(getCommandButton(toolbar, EDITOR_COMMAND_IDS.italic));

        const trigger = getOverflowTrigger(toolbar);
        trigger.focus();
        dispatchKeyboardEvent(trigger, "ArrowUp");
        const panel = toolbar.querySelector<HTMLElement>('[role="menu"]');
        if (!panel) {
            throw new Error("Expected overflow panel");
        }
        const enabledMenuItems = Array.from(panel.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"));
        expect(shadowRoot.activeElement).toBe(enabledMenuItems.at(-1));
        dispatchKeyboardEvent(enabledMenuItems.at(-1) as HTMLButtonElement, "Escape");
        expect(shadowRoot.activeElement).toBe(trigger);

        textArea.remove();
        await flushMutationObserver();
        expect(shadowRoot.querySelector(TOOLBAR_SELECTOR)).toBeNull();
    });

    test("uses scoped roving keyboard focus and isolates only handled toolbar events", () => {
        fixture = createFixture();
        const textArea = createTextArea();
        textArea.value = "value";
        textArea.setSelectionRange(0, textArea.value.length);
        textArea.focus();
        const toolbar = fixture.getToolbar();
        if (!toolbar) {
            throw new Error("Expected toolbar");
        }
        const topLevelButtons = Array.from(toolbar.children).flatMap((child) =>
            child instanceof HTMLButtonElement
                ? [child]
                : Array.from(child.children).filter(
                      (element): element is HTMLButtonElement => element instanceof HTMLButtonElement
                  )
        );
        const menuItems = Array.from(toolbar.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'));
        expect(topLevelButtons.filter((button) => button.tabIndex === 0)).toHaveLength(1);
        expect(menuItems.every((button) => button.tabIndex === -1)).toBe(true);

        const boldButton = getCommandButton(toolbar, EDITOR_COMMAND_IDS.bold);
        const italicButton = getCommandButton(toolbar, EDITOR_COMMAND_IDS.italic);
        const pageKeydown = vi.fn();
        document.addEventListener("keydown", pageKeydown);
        try {
            boldButton.focus();
            dispatchKeyboardEvent(boldButton, "ArrowRight");
            expect(document.activeElement).toBe(italicButton);
            expect(pageKeydown).not.toHaveBeenCalled();

            italicButton.addEventListener("keydown", (event) => event.preventDefault(), { once: true });
            dispatchKeyboardEvent(italicButton, "ArrowRight");
            expect(document.activeElement).toBe(italicButton);
            expect(pageKeydown).toHaveBeenCalledOnce();

            const pageInput = document.createElement("input");
            document.body.append(pageInput);
            dispatchKeyboardEvent(pageInput, "ArrowRight");
            expect(pageKeydown).toHaveBeenCalledTimes(2);
        } finally {
            document.removeEventListener("keydown", pageKeydown);
        }

        const trigger = getOverflowTrigger(toolbar);
        trigger.focus();
        trigger.click();
        const panel = toolbar.querySelector<HTMLElement>('[role="menu"]');
        if (!panel) {
            throw new Error("Expected overflow panel");
        }
        const firstMenuItem = panel.querySelector<HTMLButtonElement>("button:not(:disabled)");
        expect(document.activeElement).toBe(firstMenuItem);
        const tabEvent = dispatchKeyboardEvent(firstMenuItem as HTMLButtonElement, "Tab");
        expect(tabEvent.defaultPrevented).toBe(false);
        expect(panel.hidden).toBe(true);
    });

    test("avoids overflow panel ID collisions with host-page elements", () => {
        fixture = createFixture();
        const firstEditor = createTextArea();
        firstEditor.focus();
        const firstToolbar = fixture.getToolbar();
        const firstPanel = firstToolbar?.querySelector<HTMLElement>('[role="menu"]');
        if (!firstPanel) {
            throw new Error("Expected first overflow panel");
        }
        const firstSequence = Number(firstPanel.id.split("-").at(-1));
        fixture.dispose();
        fixture = undefined;

        const collidingElement = document.createElement("div");
        collidingElement.id = `tampermonkey-markdown-enhancer-formatting-overflow-${firstSequence + 1}`;
        document.body.append(collidingElement);
        fixture = createFixture();
        const secondEditor = createTextArea();
        secondEditor.focus();
        const secondToolbar = fixture.getToolbar();
        const secondPanel = secondToolbar?.querySelector<HTMLElement>('[role="menu"]');
        if (!secondPanel) {
            throw new Error("Expected second overflow panel");
        }

        expect(secondPanel.id).not.toBe(collidingElement.id);
        expect(getOverflowTrigger(secondToolbar as HTMLElement).getAttribute("aria-controls")).toBe(secondPanel.id);
        expect(document.querySelectorAll(`[id="${collidingElement.id}"]`)).toHaveLength(1);
    });

    test("disposer removes observers, listeners, settings subscription, and UI", async () => {
        fixture = createFixture();
        const textArea = createTextArea();
        textArea.value = "value";
        textArea.setSelectionRange(0, 5);
        textArea.focus();
        expect(fixture.getToolbar()).not.toBeNull();

        fixture.dispose();
        expect(fixture.getToolbar()).toBeNull();
        expect(dispatchKeyboardEvent(textArea, "F10", { altKey: true }).defaultPrevented).toBe(false);
        textArea.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
        fixture.setEnabled(false);
        fixture.setEnabled(true);
        document.body.append(document.createElement("div"));
        await flushMutationObserver();
        expect(fixture.getToolbar()).toBeNull();
        fixture = undefined;
    });
});
