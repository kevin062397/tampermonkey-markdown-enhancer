import { afterEach, describe, expect, test, vi } from "vitest";
import { createCommandRegistry, EDITOR_COMMAND_IDS, type EditorCommandRegistry } from "./command-registry";
import {
    attachFormattingToolbar,
    type FormattingToolbarEditor,
    type FormattingToolbarOptions
} from "./formatting-toolbar";
import { createToolbarCommandIcon, TOOLBAR_ICON_CLASS } from "./formatting-toolbar-icons";

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

interface PointerDownOptions {
    readonly button?: number;
    readonly isButtonDefined?: boolean;
    readonly isComposed?: boolean;
    readonly isPrimary?: boolean;
    readonly isPrimaryDefined?: boolean;
    readonly pointerType?: "mouse" | "touch" | "pen";
    readonly shouldThrowFromComposedPath?: boolean;
    readonly shouldUseTargetFallback?: boolean;
}

const dispatchPointerDown = (
    target: EventTarget,
    {
        button = 0,
        isButtonDefined = true,
        isComposed = true,
        isPrimary = true,
        isPrimaryDefined = true,
        pointerType = "mouse",
        shouldThrowFromComposedPath = false,
        shouldUseTargetFallback = false
    }: PointerDownOptions = {}
): Event => {
    const event = new Event("pointerdown", { bubbles: true, cancelable: true, composed: isComposed });
    const properties: PropertyDescriptorMap = {
        pointerType: { value: pointerType }
    };
    if (isButtonDefined) {
        properties.button = { value: button };
    }
    if (isPrimaryDefined) {
        properties.isPrimary = { value: isPrimary };
    }
    Object.defineProperties(event, properties);
    if (shouldThrowFromComposedPath) {
        Object.defineProperty(event, "composedPath", {
            value: () => {
                throw new Error("Unavailable composed path");
            }
        });
    } else if (shouldUseTargetFallback) {
        Object.defineProperty(event, "composedPath", { value: undefined });
    }
    target.dispatchEvent(event);
    return event;
};

const getOverflowPanel = (toolbar: HTMLElement): HTMLElement => {
    const panel = toolbar.querySelector<HTMLElement>('[role="menu"]');
    if (!panel) {
        throw new Error("Missing overflow panel");
    }
    return panel;
};

const openOverflowPanel = (toolbar: HTMLElement): HTMLElement => {
    getOverflowTrigger(toolbar).click();
    const panel = getOverflowPanel(toolbar);
    expect(panel.hidden).toBe(false);
    return panel;
};

const getPointerListenerCalls = (calls: readonly (readonly unknown[])[]): ReadonlyArray<readonly unknown[]> =>
    calls.filter(([type]) => type === "pointerdown");

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

    test("renders accessible local icons with the required toolbar text visibility", () => {
        const registry = createCommandRegistry([
            {
                id: "contributed.command",
                label: "Contributed command",
                isAvailable: () => true,
                execute: () => true
            }
        ]);
        fixture = createFixture(registry);
        const textArea = createTextArea();
        textArea.value = "value";
        textArea.setSelectionRange(0, textArea.value.length);
        textArea.focus();
        const toolbar = fixture.getToolbar();
        if (!toolbar) {
            throw new Error("Expected toolbar");
        }

        const primaryPresentations: ReadonlyArray<readonly [string, string]> = [
            [EDITOR_COMMAND_IDS.bold, "Bold"],
            [EDITOR_COMMAND_IDS.italic, "Italic"],
            [EDITOR_COMMAND_IDS.strikethrough, "Strikethrough"],
            [EDITOR_COMMAND_IDS.inlineCode, "Inline code"],
            [EDITOR_COMMAND_IDS.link, "Link"]
        ];
        for (const [commandId, label] of primaryPresentations) {
            const button = getCommandButton(toolbar, commandId);
            const icon = button.firstElementChild;
            expect(button.textContent).toBe("");
            expect(button.children).toHaveLength(1);
            expect(button.title).toBe(label);
            expect(button.getAttribute("aria-label")).toBe(label);
            expect(icon?.localName).toBe("svg");
            expect(icon?.getAttribute("aria-hidden")).toBe("true");
            expect(icon?.getAttribute("focusable")).toBe("false");
        }

        const trigger = getOverflowTrigger(toolbar);
        expect(trigger.textContent).toBe("More");
        expect(trigger.firstElementChild?.localName).toBe("svg");
        expect(trigger.firstElementChild?.getAttribute("aria-hidden")).toBe("true");
        expect(trigger.lastElementChild?.textContent).toBe("More");
        expect(trigger.title).toBe("More formatting commands");
        expect(trigger.getAttribute("aria-label")).toBe("More formatting commands");

        const overflowCommands = registry.listCommands().filter(({ id }) => !PRIMARY_COMMAND_IDS.has(id));
        for (const command of overflowCommands) {
            const button = getCommandButton(toolbar, command.id);
            expect(button.textContent).toBe(command.label);
            expect(button.title).toBe(command.label);
            expect(button.getAttribute("aria-label")).toBe(command.label);
            expect(button.firstElementChild?.localName).toBe("svg");
            expect(button.firstElementChild?.getAttribute("aria-hidden")).toBe("true");
            expect(button.lastElementChild?.textContent).toBe(command.label);
        }

        const contributedIcon = getCommandButton(toolbar, "contributed.command").querySelector("svg");
        expect(contributedIcon?.innerHTML).toBe(createToolbarCommandIcon("contributed.command").innerHTML);
        const icons = toolbar.querySelectorAll(`svg.${TOOLBAR_ICON_CLASS}`);
        expect(icons).toHaveLength(toolbar.querySelectorAll("button").length);
        expect(new Set(icons).size).toBe(icons.length);
        expect(toolbar.querySelectorAll("[src], [href]")).toHaveLength(0);

        const style = toolbar.querySelector("style");
        expect(style?.textContent).toContain(`.${TOOLBAR_ICON_CLASS}`);
        expect(style?.textContent).toContain("fill: currentColor");
        expect(style?.textContent).toContain("@media (forced-colors: active)");
        expect(style?.textContent).toContain("background: Canvas");
        expect(style?.textContent).toContain("background: ButtonFace");
        expect(style?.textContent).toContain("border-color: ButtonText");
        expect(style?.textContent).toContain("color: GrayText");
        expect(style?.textContent).toContain("opacity: 1 !important");
        expect(style?.textContent).toContain("font-weight: 600 !important");
    });

    test("executes commands from nested SVG activation targets", () => {
        fixture = createFixture();
        const textArea = createTextArea();
        textArea.value = "selected";
        textArea.setSelectionRange(0, textArea.value.length);
        textArea.focus();
        const toolbar = fixture.getToolbar();
        if (!toolbar) {
            throw new Error("Expected toolbar");
        }
        const iconTarget = getCommandButton(toolbar, EDITOR_COMMAND_IDS.bold).querySelector("path");
        if (!iconTarget) {
            throw new Error("Expected bold icon path");
        }

        const pointerEvent = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
        iconTarget.dispatchEvent(pointerEvent);
        iconTarget.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

        expect(pointerEvent.defaultPrevented).toBe(true);
        expect(textArea.value).toBe("**selected**");
        expect([textArea.selectionStart, textArea.selectionEnd]).toEqual([2, 10]);
        expect(document.activeElement).toBe(textArea);
    });

    test("dismisses overflow for primary mouse, touch, and pen pointers without consuming page behavior", () => {
        fixture = createFixture();
        const textArea = createTextArea();
        textArea.value = "selected";
        textArea.setSelectionRange(1, 6);
        textArea.focus();
        const toolbar = fixture.getToolbar();
        if (!toolbar) {
            throw new Error("Expected toolbar");
        }

        const pageControl = document.createElement("button");
        const handlePagePointerDown = vi.fn();
        const handlePageClick = vi.fn();
        pageControl.addEventListener("pointerdown", handlePagePointerDown);
        pageControl.addEventListener("click", handlePageClick);
        document.body.append(pageControl);

        for (const pointerType of ["mouse", "touch", "pen"] as const) {
            const panel = openOverflowPanel(toolbar);
            const event = dispatchPointerDown(pageControl, { pointerType });

            expect(panel.hidden).toBe(true);
            expect(getOverflowTrigger(toolbar).getAttribute("aria-expanded")).toBe("false");
            expect(event.defaultPrevented).toBe(false);
            expect(event.cancelBubble).toBe(false);
            expect(handlePagePointerDown).toHaveBeenCalledTimes(
                pointerType === "mouse" ? 1 : pointerType === "touch" ? 2 : 3
            );
            expect([textArea.selectionStart, textArea.selectionEnd]).toEqual([1, 6]);

            pageControl.focus();
            pageControl.click();
            expect(document.activeElement).toBe(pageControl);
        }
        expect(handlePageClick).toHaveBeenCalledTimes(3);

        const panel = openOverflowPanel(toolbar);
        const nonPrimaryEvent = dispatchPointerDown(pageControl, { isPrimary: false, pointerType: "pen" });
        expect(nonPrimaryEvent.defaultPrevented).toBe(false);
        expect(panel.hidden).toBe(false);

        const triggerTarget = getOverflowTrigger(toolbar).querySelector("svg");
        const panelTarget = panel.querySelector("button svg");
        if (!triggerTarget || !panelTarget) {
            throw new Error("Expected nested overflow targets");
        }
        dispatchPointerDown(triggerTarget, { shouldThrowFromComposedPath: true });
        expect(panel.hidden).toBe(false);
        dispatchPointerDown(panelTarget, {
            isComposed: false,
            pointerType: "touch",
            shouldUseTargetFallback: true
        });
        expect(panel.hidden).toBe(false);

        dispatchPointerDown(pageControl, { pointerType: "pen" });
        expect(panel.hidden).toBe(true);
    });

    test.each([
        ["missing", { shouldUseTargetFallback: true }],
        ["throwing", { shouldThrowFromComposedPath: true }]
    ] satisfies ReadonlyArray<readonly [string, PointerDownOptions]>)(
        "coordinates nested ShadowRoot dismissal when composedPath is %s",
        async (_pathState, pointerOptions) => {
            fixture = createFixture();
            const outerHost = document.createElement("div");
            const outerRoot = outerHost.attachShadow({ mode: "open" });
            const innerHost = document.createElement("div");
            const innerRoot = innerHost.attachShadow({ mode: "open" });
            const textArea = document.createElement("textarea");
            textArea.dataset.toolbarPlacement = "after-editor";
            textArea.dataset.isSupportedEditor = "true";
            innerRoot.append(textArea);
            outerRoot.append(innerHost);
            document.body.append(outerHost);
            textArea.focus();
            const toolbar = innerRoot.querySelector<HTMLElement>(TOOLBAR_SELECTOR);
            if (!toolbar) {
                throw new Error("Expected nested ShadowRoot toolbar");
            }

            const panel = openOverflowPanel(toolbar);
            const triggerTarget = getOverflowTrigger(toolbar).querySelector("path");
            const panelTarget = panel.querySelector("button span");
            if (!triggerTarget || !panelTarget) {
                throw new Error("Expected nested trigger and panel targets");
            }

            dispatchPointerDown(triggerTarget, pointerOptions);
            expect(panel.hidden).toBe(false);
            dispatchPointerDown(panelTarget, pointerOptions);
            expect(panel.hidden).toBe(false);

            const innerOutsideControl = document.createElement("button");
            const innerOutsideIcon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
            const innerOutsideTarget = document.createElementNS("http://www.w3.org/2000/svg", "path");
            innerOutsideIcon.append(innerOutsideTarget);
            innerOutsideControl.append(innerOutsideIcon);
            innerRoot.append(innerOutsideControl);
            const handleInnerPointerDown = vi.fn();
            innerOutsideControl.addEventListener("pointerdown", handleInnerPointerDown);
            innerOutsideControl.focus();

            const innerOutsideEvent = dispatchPointerDown(innerOutsideTarget, pointerOptions);

            expect(panel.hidden).toBe(true);
            expect(innerOutsideEvent.defaultPrevented).toBe(false);
            expect(innerOutsideEvent.cancelBubble).toBe(false);
            expect(handleInnerPointerDown).toHaveBeenCalledOnce();
            expect(innerRoot.activeElement).toBe(innerOutsideControl);

            const outerOutsideControl = document.createElement("button");
            const outerOutsideTarget = document.createElement("span");
            outerOutsideTarget.textContent = "Outside";
            outerOutsideControl.append(outerOutsideTarget);
            outerRoot.append(outerOutsideControl);
            const handleOuterPointerDown = vi.fn();
            outerOutsideControl.addEventListener("pointerdown", handleOuterPointerDown);
            outerOutsideControl.focus();
            openOverflowPanel(toolbar);
            const activeElementBeforeOuterPointer = outerRoot.activeElement;

            const outerOutsideEvent = dispatchPointerDown(outerOutsideTarget, pointerOptions);

            expect(panel.hidden).toBe(true);
            expect(outerOutsideEvent.defaultPrevented).toBe(false);
            expect(outerOutsideEvent.cancelBubble).toBe(false);
            expect(handleOuterPointerDown).toHaveBeenCalledOnce();
            expect(outerRoot.activeElement).toBe(activeElementBeforeOuterPointer);

            openOverflowPanel(toolbar);
            const hostEvent = dispatchPointerDown(innerHost, pointerOptions);
            expect(panel.hidden).toBe(false);

            await Promise.resolve();

            expect(panel.hidden).toBe(true);
            expect(hostEvent.defaultPrevented).toBe(false);
            expect(hostEvent.cancelBubble).toBe(false);
        }
    );

    test.each([
        ["middle", 1],
        ["right", 2]
    ])("keeps overflow open for %s mouse activation", (_buttonName, button) => {
        fixture = createFixture();
        const textArea = createTextArea();
        textArea.focus();
        const toolbar = fixture.getToolbar();
        if (!toolbar) {
            throw new Error("Expected toolbar");
        }
        const pageControl = document.createElement("button");
        document.body.append(pageControl);
        const panel = openOverflowPanel(toolbar);

        const event = dispatchPointerDown(pageControl, { button });

        expect(panel.hidden).toBe(false);
        expect(getOverflowTrigger(toolbar).getAttribute("aria-expanded")).toBe("true");
        expect(event.defaultPrevented).toBe(false);
        expect(event.cancelBubble).toBe(false);
    });

    test.each(["touch", "pen"] as const)("keeps overflow open for a non-primary %s pointer", (pointerType) => {
        fixture = createFixture();
        const textArea = createTextArea();
        textArea.focus();
        const toolbar = fixture.getToolbar();
        if (!toolbar) {
            throw new Error("Expected toolbar");
        }
        const pageControl = document.createElement("button");
        document.body.append(pageControl);
        const panel = openOverflowPanel(toolbar);

        const event = dispatchPointerDown(pageControl, { isPrimary: false, pointerType });

        expect(panel.hidden).toBe(false);
        expect(getOverflowTrigger(toolbar).getAttribute("aria-expanded")).toBe("true");
        expect(event.defaultPrevented).toBe(false);
        expect(event.cancelBubble).toBe(false);
    });

    test.each([
        ["isPrimary", { isPrimaryDefined: false }],
        ["button", { isButtonDefined: false }],
        ["both activation properties", { isButtonDefined: false, isPrimaryDefined: false }]
    ] satisfies ReadonlyArray<readonly [string, PointerDownOptions]>)(
        "dismisses overflow with missing %s",
        (_propertyName, pointerOptions) => {
            fixture = createFixture();
            const textArea = createTextArea();
            textArea.focus();
            const toolbar = fixture.getToolbar();
            if (!toolbar) {
                throw new Error("Expected toolbar");
            }
            const pageControl = document.createElement("button");
            document.body.append(pageControl);
            const panel = openOverflowPanel(toolbar);

            const event = dispatchPointerDown(pageControl, pointerOptions);

            expect(panel.hidden).toBe(true);
            expect(getOverflowTrigger(toolbar).getAttribute("aria-expanded")).toBe("false");
            expect(event.defaultPrevented).toBe(false);
            expect(event.cancelBubble).toBe(false);
        }
    );

    test("closes command actions before one saved-selection execution and keeps menu items open through pointerdown", () => {
        const registry = createCommandRegistry();
        const executeCommand = registry.executeCommand.bind(registry);
        let currentPanel: HTMLElement | undefined;
        const executeCommandSpy = vi.spyOn(registry, "executeCommand").mockImplementation((commandId, context) => {
            expect(currentPanel?.hidden).toBe(true);
            return executeCommand(commandId, context);
        });
        fixture = createFixture(registry);
        const textArea = createTextArea();
        textArea.value = "selected";
        textArea.setSelectionRange(0, textArea.value.length);
        textArea.focus();
        const toolbar = fixture.getToolbar();
        if (!toolbar) {
            throw new Error("Expected toolbar");
        }

        currentPanel = openOverflowPanel(toolbar);
        const boldButton = getCommandButton(toolbar, EDITOR_COMMAND_IDS.bold);
        dispatchPointerDown(boldButton);
        expect(currentPanel.hidden).toBe(true);
        boldButton.click();

        expect(executeCommandSpy).toHaveBeenCalledTimes(1);
        expect(executeCommandSpy).toHaveBeenLastCalledWith(EDITOR_COMMAND_IDS.bold, { textArea });
        expect(textArea.value).toBe("**selected**");
        expect([textArea.selectionStart, textArea.selectionEnd]).toEqual([2, 10]);

        textArea.value = "heading";
        textArea.setSelectionRange(0, textArea.value.length);
        textArea.dispatchEvent(new Event("select", { bubbles: true }));
        currentPanel = openOverflowPanel(toolbar);
        const overflowButton = currentPanel.querySelector<HTMLButtonElement>("button:not(:disabled)");
        const commandId = overflowButton?.dataset.commandId;
        if (!overflowButton || !commandId) {
            throw new Error("Expected enabled overflow command");
        }

        dispatchPointerDown(overflowButton, { pointerType: "touch" });
        expect(currentPanel.hidden).toBe(false);
        overflowButton.click();

        expect(currentPanel.hidden).toBe(true);
        expect(executeCommandSpy).toHaveBeenCalledTimes(2);
        expect(executeCommandSpy).toHaveBeenLastCalledWith(commandId, { textArea });
        expect(document.activeElement).toBe(textArea);
    });

    test("registers one capture listener on the document and every enclosing ShadowRoot only while open", () => {
        fixture = createFixture();
        const outerHost = document.createElement("div");
        const outerRoot = outerHost.attachShadow({ mode: "open" });
        const innerHost = document.createElement("div");
        const innerRoot = innerHost.attachShadow({ mode: "open" });
        const textArea = document.createElement("textarea");
        textArea.dataset.toolbarPlacement = "after-editor";
        textArea.dataset.isSupportedEditor = "true";
        textArea.value = "value";
        textArea.setSelectionRange(0, textArea.value.length);
        innerRoot.append(textArea);
        outerRoot.append(innerHost);
        document.body.append(outerHost);
        textArea.focus();
        const toolbar = innerRoot.querySelector<HTMLElement>(TOOLBAR_SELECTOR);
        if (!toolbar) {
            throw new Error("Expected nested ShadowRoot toolbar");
        }

        const documentAddListener = vi.spyOn(document, "addEventListener");
        const outerAddListener = vi.spyOn(outerRoot, "addEventListener");
        const innerAddListener = vi.spyOn(innerRoot, "addEventListener");
        const documentRemoveListener = vi.spyOn(document, "removeEventListener");
        const outerRemoveListener = vi.spyOn(outerRoot, "removeEventListener");
        const innerRemoveListener = vi.spyOn(innerRoot, "removeEventListener");

        const panel = openOverflowPanel(toolbar);
        const documentPointerAdds = getPointerListenerCalls(documentAddListener.mock.calls);
        const outerPointerAdds = getPointerListenerCalls(outerAddListener.mock.calls);
        const innerPointerAdds = getPointerListenerCalls(innerAddListener.mock.calls);
        expect(documentPointerAdds).toHaveLength(1);
        expect(outerPointerAdds).toHaveLength(1);
        expect(innerPointerAdds).toHaveLength(1);
        expect(documentPointerAdds[0][1]).toBe(outerPointerAdds[0][1]);
        expect(documentPointerAdds[0][1]).toBe(innerPointerAdds[0][1]);
        expect(documentPointerAdds[0][2]).toBe(true);
        expect(outerPointerAdds[0][2]).toBe(true);
        expect(innerPointerAdds[0][2]).toBe(true);

        dispatchKeyboardEvent(getOverflowTrigger(toolbar), "ArrowDown");
        expect(getPointerListenerCalls(documentAddListener.mock.calls)).toHaveLength(1);
        expect(getPointerListenerCalls(outerAddListener.mock.calls)).toHaveLength(1);
        expect(getPointerListenerCalls(innerAddListener.mock.calls)).toHaveLength(1);

        const innerPageControl = document.createElement("button");
        const innerPageIcon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        const innerPagePath = document.createElementNS("http://www.w3.org/2000/svg", "path");
        innerPageIcon.append(innerPagePath);
        innerPageControl.append(innerPageIcon);
        innerRoot.append(innerPageControl);
        const duplicateRootEvent = dispatchPointerDown(innerPagePath, {
            isComposed: false,
            pointerType: "pen",
            shouldUseTargetFallback: true
        });
        expect(panel.hidden).toBe(true);

        const outsidePointerListener = documentPointerAdds[0][1] as EventListener;
        outsidePointerListener(duplicateRootEvent);
        outsidePointerListener(duplicateRootEvent);

        const documentPointerRemoves = getPointerListenerCalls(documentRemoveListener.mock.calls);
        const outerPointerRemoves = getPointerListenerCalls(outerRemoveListener.mock.calls);
        const innerPointerRemoves = getPointerListenerCalls(innerRemoveListener.mock.calls);
        expect(documentPointerRemoves).toEqual([["pointerdown", documentPointerAdds[0][1], true]]);
        expect(outerPointerRemoves).toEqual([["pointerdown", outerPointerAdds[0][1], true]]);
        expect(innerPointerRemoves).toEqual([["pointerdown", innerPointerAdds[0][1], true]]);
    });

    test("removes old root listeners when the editor and toolbar relocate together", async () => {
        fixture = createFixture();
        const oldHost = document.createElement("div");
        const oldRoot = oldHost.attachShadow({ mode: "open" });
        const newHost = document.createElement("div");
        const newRoot = newHost.attachShadow({ mode: "open" });
        const textArea = document.createElement("textarea");
        textArea.dataset.toolbarPlacement = "after-editor";
        textArea.dataset.isSupportedEditor = "true";
        oldRoot.append(textArea);
        document.body.append(oldHost, newHost);
        textArea.focus();
        const toolbar = oldRoot.querySelector<HTMLElement>(TOOLBAR_SELECTOR);
        if (!toolbar) {
            throw new Error("Expected ShadowRoot toolbar");
        }

        const documentAddListener = vi.spyOn(document, "addEventListener");
        const oldRootAddListener = vi.spyOn(oldRoot, "addEventListener");
        const newRootAddListener = vi.spyOn(newRoot, "addEventListener");
        const documentRemoveListener = vi.spyOn(document, "removeEventListener");
        const oldRootRemoveListener = vi.spyOn(oldRoot, "removeEventListener");
        const newRootRemoveListener = vi.spyOn(newRoot, "removeEventListener");

        const panel = openOverflowPanel(toolbar);
        newRoot.append(textArea, toolbar);
        await flushMutationObserver();

        expect(panel.hidden).toBe(true);
        expect(getPointerListenerCalls(documentAddListener.mock.calls)).toHaveLength(1);
        expect(getPointerListenerCalls(oldRootAddListener.mock.calls)).toHaveLength(1);
        expect(getPointerListenerCalls(newRootAddListener.mock.calls)).toHaveLength(0);
        expect(getPointerListenerCalls(documentRemoveListener.mock.calls)).toHaveLength(1);
        expect(getPointerListenerCalls(oldRootRemoveListener.mock.calls)).toHaveLength(1);
        expect(getPointerListenerCalls(newRootRemoveListener.mock.calls)).toHaveLength(0);

        openOverflowPanel(toolbar);
        expect(getPointerListenerCalls(documentAddListener.mock.calls)).toHaveLength(2);
        expect(getPointerListenerCalls(oldRootAddListener.mock.calls)).toHaveLength(1);
        expect(getPointerListenerCalls(newRootAddListener.mock.calls)).toHaveLength(1);
        getOverflowTrigger(toolbar).click();
        expect(getPointerListenerCalls(documentRemoveListener.mock.calls)).toHaveLength(2);
        expect(getPointerListenerCalls(oldRootRemoveListener.mock.calls)).toHaveLength(1);
        expect(getPointerListenerCalls(newRootRemoveListener.mock.calls)).toHaveLength(1);
    });

    test("removes dismissal listeners on editor switches, relocation, and command rerendering", () => {
        const registry = createCommandRegistry();
        fixture = createFixture(registry);
        const firstEditor = createTextArea();
        const secondEditor = createTextArea();
        firstEditor.focus();
        const toolbar = fixture.getToolbar();
        if (!toolbar) {
            throw new Error("Expected toolbar");
        }
        const addListener = vi.spyOn(document, "addEventListener");
        const removeListener = vi.spyOn(document, "removeEventListener");

        const firstPanel = openOverflowPanel(toolbar);
        secondEditor.focus();
        expect(firstPanel.hidden).toBe(true);
        expect(getPointerListenerCalls(removeListener.mock.calls)).toHaveLength(1);

        const secondPanel = openOverflowPanel(toolbar);
        secondEditor.dataset.toolbarPlacement = "before-editor";
        secondEditor.dispatchEvent(new InputEvent("input", { bubbles: true }));
        expect(secondPanel.hidden).toBe(true);
        expect(secondEditor.previousSibling).toBe(toolbar);
        expect(getPointerListenerCalls(removeListener.mock.calls)).toHaveLength(2);

        const thirdPanel = openOverflowPanel(toolbar);
        const commands = registry.listCommands();
        vi.spyOn(registry, "listCommands").mockReturnValue([
            ...commands,
            {
                id: "custom.rerender",
                label: "Rerender command",
                isAvailable: () => true,
                execute: () => true
            }
        ]);
        secondEditor.dispatchEvent(new InputEvent("input", { bubbles: true }));
        expect(thirdPanel.hidden).toBe(true);
        expect(toolbar.querySelector('button[data-command-id="custom.rerender"]')).not.toBeNull();
        expect(getPointerListenerCalls(removeListener.mock.calls)).toHaveLength(3);
        expect(getPointerListenerCalls(addListener.mock.calls)).toHaveLength(3);
    });

    test("removes dismissal listeners for settings disable, editor removal, and disposal", async () => {
        fixture = createFixture();
        const addListener = vi.spyOn(document, "addEventListener");
        const removeListener = vi.spyOn(document, "removeEventListener");
        const textArea = createTextArea();
        textArea.focus();
        const toolbar = fixture.getToolbar();
        if (!toolbar) {
            throw new Error("Expected toolbar");
        }
        expect(getPointerListenerCalls(addListener.mock.calls)).toHaveLength(0);

        openOverflowPanel(toolbar);
        fixture.setEnabled(false);
        expect(fixture.getToolbar()).toBeNull();
        expect(getPointerListenerCalls(removeListener.mock.calls)).toHaveLength(1);

        fixture.setEnabled(true);
        textArea.focus();
        textArea.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
        const restoredToolbar = fixture.getToolbar();
        if (!restoredToolbar) {
            throw new Error("Expected restored toolbar");
        }
        openOverflowPanel(restoredToolbar);
        textArea.remove();
        await flushMutationObserver();
        expect(fixture.getToolbar()).toBeNull();
        expect(getPointerListenerCalls(removeListener.mock.calls)).toHaveLength(2);

        const remountedEditor = createTextArea();
        remountedEditor.focus();
        const remountedToolbar = fixture.getToolbar();
        if (!remountedToolbar) {
            throw new Error("Expected remounted toolbar");
        }
        openOverflowPanel(remountedToolbar);
        fixture.dispose();
        expect(fixture.getToolbar()).toBeNull();
        expect(getPointerListenerCalls(removeListener.mock.calls)).toHaveLength(3);
        expect(getPointerListenerCalls(addListener.mock.calls)).toHaveLength(3);
        fixture = undefined;
    });
});
