import { afterEach, describe, expect, test, vi } from "vitest";
import { CONCRETE_BLOCK_STYLES } from "./block-styles";
import { createCommandRegistry, EDITOR_COMMAND_IDS, type EditorCommandRegistry } from "./command-registry";
import {
    attachFormattingToolbar,
    type FormattingToolbarEditor,
    type FormattingToolbarOptions
} from "./formatting-toolbar";
import {
    createToolbarBlockStyleIcon,
    createToolbarCaretDownIcon,
    createToolbarCommandIcon,
    createToolbarMixedIcon,
    createToolbarTextIcon,
    TOOLBAR_ICON_CLASS
} from "./formatting-toolbar-icons";

const TOOLBAR_SELECTOR = "[data-tampermonkey-markdown-enhancer-formatting-toolbar]";

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
    if (
        !isEnabled ||
        !textArea.isConnected ||
        textArea.readOnly ||
        textArea.disabled ||
        textArea.matches(".excluded-editor") ||
        textArea.dataset.isSupportedEditor !== "true"
    ) {
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
                .find(
                    (target): target is HTMLTextAreaElement =>
                        typeof target === "object" &&
                        target !== null &&
                        "nodeType" in target &&
                        (target as Node).nodeType === 1 &&
                        (target as Element).localName === "textarea"
                );
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
        setEnabled: (isNextEnabled) => {
            isEnabled = isNextEnabled;
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

const getMenuPanel = (toolbar: HTMLElement, menuName: "style" | "more"): HTMLElement => {
    const panel = toolbar.querySelector<HTMLElement>(`[data-toolbar-menu="${menuName}"]`);
    if (!panel) {
        throw new Error(`Missing ${menuName} panel`);
    }
    return panel;
};

const getMenuTrigger = (toolbar: HTMLElement, menuName: "style" | "more"): HTMLButtonElement => {
    const button = toolbar.querySelector<HTMLButtonElement>(`button[data-toolbar-menu-trigger="${menuName}"]`);
    if (!button) {
        throw new Error(`Missing ${menuName} trigger`);
    }
    return button;
};

const getStylePanel = (toolbar: HTMLElement): HTMLElement => getMenuPanel(toolbar, "style");

const openStylePanel = (toolbar: HTMLElement): HTMLElement => {
    getStyleTrigger(toolbar).click();
    const panel = getStylePanel(toolbar);
    expect(panel.hidden).toBe(false);
    return panel;
};

const openMorePanel = (toolbar: HTMLElement): HTMLElement => {
    getMenuTrigger(toolbar, "more").click();
    const panel = getMenuPanel(toolbar, "more");
    expect(panel.hidden).toBe(false);
    return panel;
};

const getPointerListenerCalls = (calls: readonly (readonly unknown[])[]): ReadonlyArray<readonly unknown[]> =>
    calls.filter(([type]) => type === "pointerdown");

const TOOLBAR_DOCUMENT_EVENT_TYPES = ["focusin", "selectionchange", "input", "select", "keyup", "keydown"] as const;
const TOOLBAR_ACTIVE_EVENT_TYPES = TOOLBAR_DOCUMENT_EVENT_TYPES.slice(1);

const getToolbarDocumentListenerTypes = (calls: readonly (readonly unknown[])[]): unknown[] =>
    calls
        .filter(([type]) =>
            TOOLBAR_DOCUMENT_EVENT_TYPES.includes(type as (typeof TOOLBAR_DOCUMENT_EVENT_TYPES)[number])
        )
        .map(([type]) => type);

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

const getStyleTrigger = (toolbar: HTMLElement): HTMLButtonElement => getMenuTrigger(toolbar, "style");

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

    test("uses the pointerdown selection when the host changes selection before click", () => {
        fixture = createFixture();
        const textArea = createTextArea();
        textArea.value = "selected";
        textArea.setSelectionRange(0, textArea.value.length);
        textArea.focus();
        const toolbar = fixture.getToolbar();
        if (!toolbar) {
            throw new Error("Expected toolbar");
        }
        const boldButton = getCommandButton(toolbar, EDITOR_COMMAND_IDS.bold);

        boldButton.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
        textArea.setSelectionRange(0, 0);
        boldButton.click();

        expect(textArea.value).toBe("**selected**");
        expect([textArea.selectionStart, textArea.selectionEnd]).toEqual([2, 10]);
    });

    test("keeps the original Bold range authoritative during toolbar activation and delayed editor events", async () => {
        fixture = createFixture();
        const textArea = createTextArea();
        textArea.value = "selected";
        textArea.setSelectionRange(0, textArea.value.length, "backward");
        textArea.focus();
        const toolbar = fixture.getToolbar();
        if (!toolbar) {
            throw new Error("Expected toolbar");
        }
        const boldButton = getCommandButton(toolbar, EDITOR_COMMAND_IDS.bold);
        const collapseSelection = (): void => textArea.setSelectionRange(0, 0);
        document.addEventListener("mousedown", collapseSelection, true);
        try {
            boldButton.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
            boldButton.focus();
            textArea.dispatchEvent(new InputEvent("input", { bubbles: true }));
            textArea.dispatchEvent(new Event("select", { bubbles: true }));
            await Promise.resolve();
            boldButton.click();
        } finally {
            document.removeEventListener("mousedown", collapseSelection, true);
        }

        expect(textArea.value).toBe("**selected**");
        expect([textArea.selectionStart, textArea.selectionEnd, textArea.selectionDirection]).toEqual([
            2,
            10,
            "backward"
        ]);
    });

    test("uses one original range for Style presentation and execution through delayed editor events", async () => {
        fixture = createFixture();
        const textArea = createTextArea();
        textArea.value = "# first\nsecond";
        textArea.setSelectionRange(0, textArea.value.length, "backward");
        textArea.focus();
        const toolbar = fixture.getToolbar();
        if (!toolbar) {
            throw new Error("Expected toolbar");
        }
        const trigger = getStyleTrigger(toolbar);
        const collapseSelection = (): void => textArea.setSelectionRange(2, 2);
        document.addEventListener("mousedown", collapseSelection, true);
        try {
            trigger.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
            trigger.focus();
            trigger.click();
            expect(trigger.textContent).toBe("Mixed");

            textArea.dispatchEvent(new InputEvent("input", { bubbles: true }));
            textArea.dispatchEvent(new Event("select", { bubbles: true }));
            await Promise.resolve();
            expect(trigger.textContent).toBe("Mixed");

            const headingButton = getStylePanel(toolbar).querySelector<HTMLButtonElement>(
                'button[data-block-style="heading1"]'
            );
            if (!headingButton) {
                throw new Error("Expected Heading 1 row");
            }
            headingButton.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
            headingButton.click();
        } finally {
            document.removeEventListener("mousedown", collapseSelection, true);
        }

        expect(textArea.value).toBe("# first\n# second");
        expect([textArea.selectionStart, textArea.selectionEnd, textArea.selectionDirection]).toEqual([
            0,
            16,
            "backward"
        ]);
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

    test("refreshes the Style presentation for editor state events, mixed selections, and blanks", async () => {
        fixture = createFixture();
        const textArea = createTextArea();
        textArea.value = "# Heading";
        textArea.setSelectionRange(2, 2);
        textArea.focus();
        const toolbar = fixture.getToolbar();
        if (!toolbar) {
            throw new Error("Expected toolbar");
        }
        const trigger = getMenuTrigger(toolbar, "style");
        const panel = getMenuPanel(toolbar, "style");
        const getCheckedStyles = (): Array<string | undefined> =>
            Array.from(
                panel.querySelectorAll<HTMLButtonElement>('button[aria-checked="true"]'),
                (button) => button.dataset.blockStyle
            );

        expect(trigger.textContent).toBe("Heading 1");
        expect(trigger.firstElementChild?.innerHTML).toBe(
            createToolbarCommandIcon(EDITOR_COMMAND_IDS.heading1).innerHTML
        );
        expect(getCheckedStyles()).toEqual(["heading1"]);

        textArea.value = "> Quote";
        textArea.setSelectionRange(2, 2);
        textArea.dispatchEvent(new InputEvent("input", { bubbles: true }));
        await Promise.resolve();
        expect(trigger.textContent).toBe("Blockquote");

        textArea.value = "1. Item";
        textArea.setSelectionRange(3, 3);
        textArea.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, key: "m" }));
        await Promise.resolve();
        expect(trigger.textContent).toBe("Numbered List");

        textArea.value = "# Heading\nplain";
        textArea.setSelectionRange(0, textArea.value.length);
        textArea.dispatchEvent(new Event("select", { bubbles: true }));
        await Promise.resolve();
        expect(trigger.textContent).toBe("Mixed");
        expect(trigger.firstElementChild?.innerHTML).toBe(createToolbarMixedIcon().innerHTML);
        expect(getCheckedStyles()).toEqual([]);
        expect(panel.textContent).not.toContain("Mixed");

        trigger.click();
        expect(document.activeElement).toBe(panel.querySelector('button[data-block-style="text"]'));
        dispatchKeyboardEvent(document.activeElement as HTMLButtonElement, "Escape");

        textArea.value = "# Heading\n\n";
        textArea.setSelectionRange(0, textArea.value.length);
        textArea.focus();
        document.dispatchEvent(new Event("selectionchange"));
        await Promise.resolve();
        expect(trigger.textContent).toBe("Heading 1");

        textArea.setSelectionRange(textArea.value.length, textArea.value.length);
        document.dispatchEvent(new Event("selectionchange"));
        await Promise.resolve();
        expect(trigger.textContent).toBe("Text");
        expect(trigger.firstElementChild?.innerHTML).toBe(createToolbarTextIcon().innerHTML);
    });

    test("executes a Style row with saved selection and refreshes its radio state immediately", () => {
        fixture = createFixture();
        const textArea = createTextArea();
        textArea.value = "heading";
        textArea.setSelectionRange(0, textArea.value.length, "backward");
        textArea.focus();
        const toolbar = fixture.getToolbar();
        if (!toolbar) {
            throw new Error("Expected toolbar");
        }
        const trigger = getMenuTrigger(toolbar, "style");
        const panel = openStylePanel(toolbar);
        const headingButton = panel.querySelector<HTMLButtonElement>('button[data-block-style="heading1"]');
        if (!headingButton) {
            throw new Error("Expected Heading 1 row");
        }

        dispatchMouseActivation(headingButton);

        expect(textArea.value).toBe("# heading");
        expect([textArea.selectionStart, textArea.selectionEnd, textArea.selectionDirection]).toEqual([
            2,
            9,
            "backward"
        ]);
        expect(document.activeElement).toBe(textArea);
        expect(panel.hidden).toBe(true);
        expect(trigger.textContent).toBe("Heading 1");
        expect(headingButton.getAttribute("aria-checked")).toBe("true");
        expect(headingButton.textContent).toBe("Heading 1");
    });

    test("keeps an all-unavailable Style composite operable while preserving More availability behavior", () => {
        const registry = createCommandRegistry([
            {
                id: "custom.unavailable",
                label: "Unavailable action",
                isAvailable: () => false,
                execute: () => true
            }
        ]);
        const getCommand = registry.getCommand.bind(registry);
        vi.spyOn(registry, "getCommand").mockImplementation((id) => {
            const command = getCommand(id);
            return command?.blockStyle ? { ...command, isAvailable: () => false } : command;
        });
        fixture = createFixture(registry);
        const textArea = createTextArea();
        textArea.focus();
        const toolbar = fixture.getToolbar();
        if (!toolbar) {
            throw new Error("Expected toolbar");
        }

        const styleTrigger = getMenuTrigger(toolbar, "style");
        expect(styleTrigger.disabled).toBe(false);
        expect(getMenuTrigger(toolbar, "more").disabled).toBe(true);
        expect(getCommandButton(toolbar, "custom.unavailable").disabled).toBe(true);
        expect(
            Array.from(getMenuPanel(toolbar, "style").querySelectorAll<HTMLButtonElement>("button")).every(
                (button) => !button.disabled && button.getAttribute("aria-disabled") === "true"
            )
        ).toBe(true);

        styleTrigger.click();
        const activeRow = getMenuPanel(toolbar, "style").querySelector<HTMLButtonElement>(
            'button[data-block-style="text"]'
        );
        expect(getMenuPanel(toolbar, "style").hidden).toBe(false);
        expect(document.activeElement).toBe(activeRow);
        activeRow?.click();
        expect(getMenuPanel(toolbar, "style").hidden).toBe(false);
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

    test("derives canonical Style rows from block metadata and keeps More for contributed actions", () => {
        const registry = createCommandRegistry([
            {
                id: "custom.first",
                label: "First action",
                isAvailable: () => true,
                execute: () => true
            },
            {
                id: "custom.last",
                label: "Last action",
                isAvailable: () => true,
                execute: () => true
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
        const styleTrigger = getMenuTrigger(toolbar, "style");
        const stylePanel = getMenuPanel(toolbar, "style");
        expect(
            Array.from(
                toolbar.querySelectorAll<HTMLButtonElement>("button[data-toolbar-menu-trigger]"),
                (button) => button.dataset.toolbarMenuTrigger
            )
        ).toEqual(["style", "more"]);
        const styleButtons = Array.from(stylePanel.querySelectorAll<HTMLButtonElement>('button[role="menuitemradio"]'));

        expect(styleButtons.map((button) => button.dataset.blockStyle)).toEqual(CONCRETE_BLOCK_STYLES);
        expect(new Set(styleButtons.map((button) => button.dataset.commandId)).size).toBe(CONCRETE_BLOCK_STYLES.length);
        expect(
            Array.from(stylePanel.children, (element) =>
                element.getAttribute("role") === "separator" ? "separator" : element.getAttribute("data-block-style")
            )
        ).toEqual([
            "text",
            "heading1",
            "heading2",
            "heading3",
            "heading4",
            "heading5",
            "heading6",
            "separator",
            "blockquote",
            "codeBlock",
            "separator",
            "bulletList",
            "numberedList",
            "taskList"
        ]);
        expect(styleButtons.filter((button) => button.getAttribute("aria-checked") === "true")).toEqual([
            styleButtons[0]
        ]);
        expect(styleButtons[0].className).toContain("__menu-item--active");
        expect(styleButtons[0].textContent).toBe("Text");
        expect(styleButtons[0].children).toHaveLength(2);
        expect(stylePanel.textContent).not.toContain("Mixed");

        styleTrigger.focus();
        expect(dispatchKeyboardEvent(styleTrigger, "ArrowDown").defaultPrevented).toBe(true);
        expect(document.activeElement).toBe(styleButtons[0]);
        dispatchKeyboardEvent(styleButtons[0], "ArrowUp");
        expect(document.activeElement).toBe(styleButtons.at(-1));
        dispatchKeyboardEvent(styleButtons.at(-1) as HTMLButtonElement, "Home");
        expect(document.activeElement).toBe(styleButtons[0]);
        dispatchKeyboardEvent(styleButtons[0], "End");
        expect(document.activeElement).toBe(styleButtons.at(-1));

        const moreTrigger = getMenuTrigger(toolbar, "more");
        dispatchKeyboardEvent(moreTrigger, "ArrowDown");
        const morePanel = getMenuPanel(toolbar, "more");
        const moreButtons = Array.from(morePanel.querySelectorAll<HTMLButtonElement>('button[role="menuitem"]'));
        expect(stylePanel.hidden).toBe(true);
        expect(moreButtons.map((button) => button.dataset.commandId)).toEqual(["custom.first", "custom.last"]);
        expect(moreButtons.every((button) => button.dataset.blockStyle === undefined)).toBe(true);
        expect(document.activeElement).toBe(moreButtons[0]);
        dispatchKeyboardEvent(moreButtons[0], "Escape");
        expect(morePanel.hidden).toBe(true);
        expect(document.activeElement).toBe(moreTrigger);
        moreTrigger.focus();
        dispatchKeyboardEvent(moreTrigger, "ArrowUp");
        expect(document.activeElement).toBe(moreButtons.at(-1));
    });

    test("restores the Style trigger after a pointer toggle closes its focused panel", () => {
        fixture = createFixture();
        const textArea = createTextArea();
        textArea.focus();
        const toolbar = fixture.getToolbar();
        if (!toolbar) {
            throw new Error("Expected toolbar");
        }
        const trigger = getMenuTrigger(toolbar, "style");
        const panel = openStylePanel(toolbar);
        expect(panel.contains(document.activeElement)).toBe(true);

        const mouseDown = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
        trigger.dispatchEvent(mouseDown);
        trigger.click();

        expect(mouseDown.defaultPrevented).toBe(true);
        expect(panel.hidden).toBe(true);
        expect(trigger.getAttribute("aria-expanded")).toBe("false");
        expect(document.activeElement).toBe(trigger);
    });

    test("restores the More trigger after a pointer toggle closes its focused panel when available", () => {
        fixture = createFixture(
            createCommandRegistry([
                {
                    id: "custom.action",
                    label: "Custom action",
                    isAvailable: () => true,
                    execute: () => true
                }
            ])
        );
        const textArea = createTextArea();
        textArea.focus();
        const toolbar = fixture.getToolbar();
        if (!toolbar) {
            throw new Error("Expected toolbar");
        }
        const trigger = getMenuTrigger(toolbar, "more");
        const panel = openMorePanel(toolbar);
        expect(panel.contains(document.activeElement)).toBe(true);

        const mouseDown = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
        trigger.dispatchEvent(mouseDown);
        trigger.click();

        expect(mouseDown.defaultPrevented).toBe(true);
        expect(panel.hidden).toBe(true);
        expect(trigger.getAttribute("aria-expanded")).toBe("false");
        expect(document.activeElement).toBe(trigger);
    });

    test("renders each block style once when contributed metadata replaces a canonical row", () => {
        const registry = createCommandRegistry([
            {
                id: "custom.title",
                label: "Title",
                blockStyle: "heading1",
                isAvailable: () => true,
                execute: () => true
            }
        ]);
        fixture = createFixture(registry);
        const textArea = createTextArea();
        textArea.value = "# Heading";
        textArea.setSelectionRange(2, 2);
        textArea.focus();
        const toolbar = fixture.getToolbar();
        if (!toolbar) {
            throw new Error("Expected toolbar");
        }
        const panel = getMenuPanel(toolbar, "style");

        const headingRow = panel.querySelector<HTMLButtonElement>('button[data-block-style="heading1"]');
        expect(headingRow).not.toBeNull();
        expect(headingRow?.getAttribute("data-command-id")).toBe("custom.title");
        expect(headingRow?.querySelector("svg")?.innerHTML).toBe(createToolbarBlockStyleIcon("heading1").innerHTML);
        expect(getMenuTrigger(toolbar, "style").textContent).toBe("Title");
        expect(getMenuTrigger(toolbar, "style").querySelector("svg")?.innerHTML).toBe(
            createToolbarBlockStyleIcon("heading1").innerHTML
        );
        expect(toolbar.querySelector(`[data-command-id="${EDITOR_COMMAND_IDS.heading1}"]`)).toBeNull();
        expect(toolbar.querySelector('[data-toolbar-menu-trigger="more"]')).toBeNull();
    });

    test("omits More when the registry has no contributed non-style actions", () => {
        fixture = createFixture();
        const textArea = createTextArea();
        textArea.focus();
        const toolbar = fixture.getToolbar();
        if (!toolbar) {
            throw new Error("Expected toolbar");
        }

        expect(toolbar.querySelector('[data-toolbar-menu-trigger="style"]')).not.toBeNull();
        expect(toolbar.querySelector('[data-toolbar-menu-trigger="more"]')).toBeNull();
        expect(toolbar.querySelector('[data-toolbar-menu="more"]')).toBeNull();

        const trigger = getMenuTrigger(toolbar, "style");
        const panel = getMenuPanel(toolbar, "style");
        trigger.click();
        expect(panel.hidden).toBe(false);
        trigger.click();
        expect(panel.hidden).toBe(true);
        expect(trigger.getAttribute("aria-expanded")).toBe("false");
    });

    test("executes contributed More actions with the saved editor selection", () => {
        const execute = vi.fn(({ textArea }: { readonly textArea: HTMLTextAreaElement }) => {
            textArea.setRangeText("updated", textArea.selectionStart, textArea.selectionEnd, "select");
            return true;
        });
        fixture = createFixture(
            createCommandRegistry([
                {
                    id: "custom.update",
                    label: "Update selection",
                    isAvailable: () => true,
                    execute
                }
            ])
        );
        const textArea = createTextArea();
        textArea.value = "before selected after";
        textArea.setSelectionRange(7, 15);
        textArea.focus();
        const toolbar = fixture.getToolbar();
        if (!toolbar) {
            throw new Error("Expected toolbar");
        }
        const panel = openMorePanel(toolbar);
        const action = getCommandButton(toolbar, "custom.update");

        dispatchMouseActivation(action);

        expect(execute).toHaveBeenCalledOnce();
        expect(textArea.value).toBe("before updated after");
        expect([textArea.selectionStart, textArea.selectionEnd]).toEqual([7, 14]);
        expect(document.activeElement).toBe(textArea);
        expect(panel.hidden).toBe(true);
        expect(getMenuTrigger(toolbar, "more").getAttribute("aria-expanded")).toBe("false");
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

    test("refreshes active Style state when settings notify the toolbar", () => {
        fixture = createFixture();
        const textArea = createTextArea();
        textArea.value = "# Heading";
        textArea.setSelectionRange(2, 2);
        textArea.focus();
        const toolbar = fixture.getToolbar();
        if (!toolbar) {
            throw new Error("Expected toolbar");
        }
        const trigger = getMenuTrigger(toolbar, "style");
        expect(trigger.textContent).toBe("Heading 1");

        textArea.value = "plain";
        textArea.setSelectionRange(2, 2);
        fixture.setEnabled(true);

        expect(trigger.textContent).toBe("Text");
        expect(getCommandButton(toolbar, EDITOR_COMMAND_IDS.text).getAttribute("aria-checked")).toBe("true");
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

        const trigger = getStyleTrigger(toolbar);
        trigger.focus();
        dispatchKeyboardEvent(trigger, "ArrowUp");
        const panel = getMenuPanel(toolbar, "style");
        const enabledMenuItems = Array.from(panel.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"));
        expect(shadowRoot.activeElement).toBe(enabledMenuItems[0]);
        dispatchKeyboardEvent(enabledMenuItems[0], "Escape");
        expect(shadowRoot.activeElement).toBe(trigger);

        textArea.remove();
        await flushMutationObserver();
        expect(shadowRoot.querySelector(TOOLBAR_SELECTOR)).toBeNull();
    });

    test("cleans up when an enclosing ShadowRoot host is removed", async () => {
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
        const removeListener = vi.spyOn(document, "removeEventListener");
        openStylePanel(toolbar);

        innerHost.remove();
        await flushMutationObserver();

        expect(innerRoot.querySelector(TOOLBAR_SELECTOR)).toBeNull();
        expect(getPointerListenerCalls(removeListener.mock.calls)).toHaveLength(1);
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
        const menuItems = Array.from(
            toolbar.querySelectorAll<HTMLButtonElement>('[role="menuitem"], [role="menuitemradio"]')
        );
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

        const trigger = getStyleTrigger(toolbar);
        trigger.focus();
        trigger.click();
        const panel = toolbar.querySelector<HTMLElement>('[role="menu"]');
        if (!panel) {
            throw new Error("Expected Style menu");
        }
        const firstMenuItem = panel.querySelector<HTMLButtonElement>("button:not(:disabled)");
        expect(document.activeElement).toBe(firstMenuItem);
        const tabEvent = dispatchKeyboardEvent(firstMenuItem as HTMLButtonElement, "Tab");
        expect(tabEvent.defaultPrevented).toBe(false);
        expect(panel.hidden).toBe(true);
        expect(document.activeElement).toBe(firstMenuItem);
    });

    test("avoids Style menu ID collisions with host-page elements", () => {
        fixture = createFixture();
        const firstEditor = createTextArea();
        firstEditor.focus();
        const firstToolbar = fixture.getToolbar();
        const firstPanel = firstToolbar?.querySelector<HTMLElement>('[role="menu"]');
        if (!firstPanel) {
            throw new Error("Expected first Style menu");
        }
        const firstSequence = Number(firstPanel.id.split("-").at(-1));
        fixture.dispose();
        fixture = undefined;

        const collidingElement = document.createElement("div");
        collidingElement.id = firstPanel.id.replace(/\d+$/, String(firstSequence + 1));
        document.body.append(collidingElement);
        fixture = createFixture();
        const secondEditor = createTextArea();
        secondEditor.focus();
        const secondToolbar = fixture.getToolbar();
        const secondPanel = secondToolbar?.querySelector<HTMLElement>('[role="menu"]');
        if (!secondPanel) {
            throw new Error("Expected second Style menu");
        }

        expect(secondPanel.id).not.toBe(collidingElement.id);
        expect(getStyleTrigger(secondToolbar as HTMLElement).getAttribute("aria-controls")).toBe(secondPanel.id);
        expect(document.querySelectorAll(`[id="${collidingElement.id}"]`)).toHaveLength(1);
    });

    test("revalidates menu IDs after a same-root host mutation", async () => {
        fixture = createFixture();
        const textArea = createTextArea();
        textArea.focus();
        const toolbar = fixture.getToolbar();
        if (!toolbar) {
            throw new Error("Expected toolbar");
        }
        const originalPanel = openStylePanel(toolbar);
        const originalFocusedRow = originalPanel.querySelector<HTMLButtonElement>(
            'button[data-block-style="heading2"]'
        );
        originalFocusedRow?.focus();
        const collision = document.createElement("div");
        collision.id = originalPanel.id;

        document.body.append(collision);
        await flushMutationObserver();

        const replacementPanel = getMenuPanel(toolbar, "style");
        expect(replacementPanel).not.toBe(originalPanel);
        expect(replacementPanel.id).not.toBe(collision.id);
        expect(document.querySelectorAll(`[id="${collision.id}"]`)).toHaveLength(1);
        expect(getMenuTrigger(toolbar, "style").getAttribute("aria-controls")).toBe(replacementPanel.id);
        expect(replacementPanel.hidden).toBe(false);
        expect(document.activeElement).toBe(
            replacementPanel.querySelector<HTMLButtonElement>('button[data-block-style="heading2"]')
        );
    });

    test("revalidates Style and More IDs when the toolbar crosses ShadowRoot boundaries", async () => {
        fixture = createFixture(
            createCommandRegistry([
                {
                    id: "custom.action",
                    label: "Custom action",
                    isAvailable: () => true,
                    execute: () => true
                }
            ])
        );
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
            throw new Error("Expected toolbar");
        }
        const oldMorePanel = getMenuPanel(toolbar, "more");
        const nextSequence = Number(oldMorePanel.id.split("-").at(-1)) + 1;
        const styleCollision = document.createElement("div");
        styleCollision.id = `tampermonkey-markdown-enhancer-formatting-style-${nextSequence}`;
        const moreCollision = document.createElement("div");
        moreCollision.id = `tampermonkey-markdown-enhancer-formatting-more-${nextSequence + 1}`;
        newRoot.append(styleCollision, moreCollision);
        const oldStylePanel = openStylePanel(toolbar);
        oldStylePanel.querySelector<HTMLButtonElement>('button[data-block-style="heading3"]')?.focus();

        newRoot.append(textArea, toolbar);
        await flushMutationObserver();

        const relocatedStylePanel = getMenuPanel(toolbar, "style");
        const relocatedMorePanel = getMenuPanel(toolbar, "more");
        expect(relocatedStylePanel.id).not.toBe(styleCollision.id);
        expect(relocatedMorePanel.id).not.toBe(moreCollision.id);
        expect(newRoot.querySelectorAll(`[id="${styleCollision.id}"]`)).toHaveLength(1);
        expect(newRoot.querySelectorAll(`[id="${moreCollision.id}"]`)).toHaveLength(1);
        expect(getMenuTrigger(toolbar, "style").getAttribute("aria-controls")).toBe(relocatedStylePanel.id);
        expect(getMenuTrigger(toolbar, "more").getAttribute("aria-controls")).toBe(relocatedMorePanel.id);
        expect(relocatedStylePanel.hidden).toBe(false);
        expect(newRoot.activeElement).toBe(
            relocatedStylePanel.querySelector<HTMLButtonElement>('button[data-block-style="heading3"]')
        );
    });

    test.each(["style", "more"] as const)(
        "keeps %s closed after outside dismissal relocates the editor and toolbar into a ShadowRoot",
        async (menuName) => {
            const registry =
                menuName === "more"
                    ? createCommandRegistry([
                          {
                              id: "custom.action",
                              label: "Custom action",
                              isAvailable: () => true,
                              execute: () => true
                          }
                      ])
                    : createCommandRegistry();
            fixture = createFixture(registry);
            const textArea = createTextArea();
            textArea.focus();
            const toolbar = fixture.getToolbar();
            if (!toolbar) {
                throw new Error("Expected toolbar");
            }
            const panel = menuName === "style" ? openStylePanel(toolbar) : openMorePanel(toolbar);
            const focusedRow =
                menuName === "style"
                    ? panel.querySelector<HTMLButtonElement>('button[data-block-style="heading3"]')
                    : panel.querySelector<HTMLButtonElement>('button[data-command-id="custom.action"]');
            if (!focusedRow) {
                throw new Error(`Expected focused ${menuName} row`);
            }
            focusedRow.focus();

            const host = document.createElement("div");
            const shadowRoot = host.attachShadow({ mode: "open" });
            const outsideTarget = document.createElement("span");
            document.body.append(host, outsideTarget);
            outsideTarget.addEventListener("pointerdown", () => shadowRoot.append(textArea, toolbar));

            dispatchPointerDown(outsideTarget);
            await flushMutationObserver();

            const replacementPanel = getMenuPanel(toolbar, menuName);
            expect(panel.hidden).toBe(true);
            expect(replacementPanel).not.toBe(panel);
            expect(replacementPanel.hidden).toBe(true);
            expect(getMenuTrigger(toolbar, menuName).getAttribute("aria-expanded")).toBe("false");
            expect(shadowRoot.activeElement === null || !toolbar.contains(shadowRoot.activeElement)).toBe(true);
        }
    );

    test.each(["style", "more"] as const)(
        "preserves focused %s menu state when the editor and toolbar relocate into a ShadowRoot",
        async (menuName) => {
            const registry =
                menuName === "more"
                    ? createCommandRegistry([
                          {
                              id: "custom.action",
                              label: "Custom action",
                              isAvailable: () => true,
                              execute: () => true
                          }
                      ])
                    : createCommandRegistry();
            fixture = createFixture(registry);
            const textArea = createTextArea();
            textArea.focus();
            const toolbar = fixture.getToolbar();
            if (!toolbar) {
                throw new Error("Expected toolbar");
            }
            const panel = menuName === "style" ? openStylePanel(toolbar) : openMorePanel(toolbar);
            const focusedRow =
                menuName === "style"
                    ? panel.querySelector<HTMLButtonElement>('button[data-block-style="heading3"]')
                    : panel.querySelector<HTMLButtonElement>('button[data-command-id="custom.action"]');
            if (!focusedRow) {
                throw new Error(`Expected focused ${menuName} row`);
            }
            focusedRow.focus();

            const host = document.createElement("div");
            const shadowRoot = host.attachShadow({ mode: "open" });
            document.body.append(host);
            shadowRoot.append(textArea, toolbar);
            await flushMutationObserver();

            const replacementPanel = getMenuPanel(toolbar, menuName);
            expect(panel.hidden).toBe(true);
            expect(replacementPanel).not.toBe(panel);
            expect(replacementPanel.hidden).toBe(false);
            expect(shadowRoot.activeElement).toBe(
                replacementPanel.querySelector<HTMLButtonElement>(
                    menuName === "style"
                        ? 'button[data-block-style="heading3"]'
                        : 'button[data-command-id="custom.action"]'
                )
            );
        }
    );

    test("rebinds menu IDs and state events after cross-document relocation", async () => {
        fixture = createFixture();
        const textArea = createTextArea();
        textArea.value = "# Heading";
        textArea.setSelectionRange(2, 2);
        textArea.focus();
        const toolbar = fixture.getToolbar();
        if (!toolbar) {
            throw new Error("Expected toolbar");
        }
        const originalPanel = getMenuPanel(toolbar, "style");
        const nextSequence = Number(originalPanel.id.split("-").at(-1)) + 1;
        const destinationDocument = document.implementation.createHTMLDocument("destination");
        const collision = destinationDocument.createElement("div");
        collision.id = `tampermonkey-markdown-enhancer-formatting-style-${nextSequence}`;
        destinationDocument.body.append(collision);

        destinationDocument.body.append(textArea, toolbar);
        await flushMutationObserver();

        const relocatedPanel = getMenuPanel(toolbar, "style");
        expect(relocatedPanel.id).not.toBe(collision.id);
        expect(destinationDocument.querySelectorAll(`[id="${collision.id}"]`)).toHaveLength(1);
        textArea.value = "> Quote";
        textArea.setSelectionRange(2, 2);
        textArea.dispatchEvent(new InputEvent("input", { bubbles: true }));
        await Promise.resolve();
        expect(getMenuTrigger(toolbar, "style").textContent).toBe("Blockquote");
    });

    test("switches to an already-focused foreign-realm ShadowRoot editor after destination listener installation", async () => {
        fixture = createFixture();
        const sourceEditor = createTextArea();
        sourceEditor.focus();
        const toolbar = fixture.getToolbar();
        if (!toolbar) {
            throw new Error("Expected toolbar");
        }
        const frame = document.createElement("iframe");
        document.body.append(frame);
        const destinationDocument = frame.contentDocument;
        if (!destinationDocument) {
            throw new Error("Expected iframe document");
        }
        const host = destinationDocument.createElement("div");
        const destinationRoot = host.attachShadow({ mode: "open" });
        const destinationEditor = destinationDocument.createElement("textarea");
        destinationEditor.dataset.toolbarPlacement = "after-editor";
        destinationEditor.dataset.isSupportedEditor = "true";
        destinationEditor.value = "plain";
        destinationEditor.setSelectionRange(0, 0);
        destinationRoot.append(destinationEditor);
        destinationDocument.body.append(host);
        const addRootListener = vi.spyOn(destinationRoot, "addEventListener");
        destinationEditor.focus();

        destinationRoot.append(sourceEditor, toolbar);
        await flushMutationObserver();

        expect(destinationRoot.activeElement).toBe(destinationEditor);
        expect(destinationEditor.nextSibling).toBe(toolbar);
        expect(addRootListener.mock.calls.filter(([type]) => type === "selectionchange")).toHaveLength(1);

        destinationEditor.value = "# Heading";
        destinationEditor.setSelectionRange(2, 2);
        destinationEditor.dispatchEvent(new Event("selectionchange", { bubbles: true, composed: false }));
        expect(getStyleTrigger(toolbar).textContent).toBe("Heading 1");
    });

    test("removes the toolbar and owning-document listeners when its iframe disconnects", async () => {
        fixture = createFixture();
        const textArea = createTextArea();
        textArea.focus();
        const toolbar = fixture.getToolbar();
        if (!toolbar) {
            throw new Error("Expected toolbar");
        }
        const frame = document.createElement("iframe");
        document.body.append(frame);
        const ownerDocument = frame.contentDocument;
        if (!ownerDocument) {
            throw new Error("Expected iframe document");
        }
        const removeListener = vi.spyOn(ownerDocument, "removeEventListener");

        ownerDocument.body.append(textArea, toolbar);
        await flushMutationObserver();
        expect(ownerDocument.querySelector(TOOLBAR_SELECTOR)).toBe(toolbar);

        frame.remove();
        await flushMutationObserver();

        expect(ownerDocument.querySelector(TOOLBAR_SELECTOR)).toBeNull();
        expect(getToolbarDocumentListenerTypes(removeListener.mock.calls)).toEqual(TOOLBAR_DOCUMENT_EVENT_TYPES);
    });

    test("revalidates every active textarea attribute for exclusions without observing toolbar mutations", async () => {
        const observeMutation = vi.spyOn(MutationObserver.prototype, "observe");
        fixture = createFixture();
        const textArea = createTextArea();
        textArea.focus();
        const toolbar = fixture.getToolbar();
        if (!toolbar) {
            throw new Error("Expected toolbar");
        }
        expect(
            observeMutation.mock.calls.some(
                ([target, options]) => target === textArea && (options as MutationObserverInit).attributes === true
            )
        ).toBe(true);
        expect(
            observeMutation.mock.calls.some(
                ([target, options]) => target === toolbar && (options as MutationObserverInit).attributes === true
            )
        ).toBe(false);

        textArea.classList.add("excluded-editor");
        await flushMutationObserver();
        expect(document.querySelector(TOOLBAR_SELECTOR)).toBeNull();

        textArea.classList.remove("excluded-editor");
        textArea.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
        expect(textArea.nextSibling).toBe(toolbar);
    });

    test("retains only the latest ownerDocument focus discovery listener across settings changes", async () => {
        const observeMutation = vi.spyOn(MutationObserver.prototype, "observe");
        const disconnectMutation = vi.spyOn(MutationObserver.prototype, "disconnect");
        const initialRemoveListener = vi.spyOn(document, "removeEventListener");
        fixture = createFixture();
        const textArea = createTextArea();
        textArea.focus();
        const toolbar = fixture.getToolbar();
        if (!toolbar) {
            throw new Error("Expected toolbar");
        }
        const destinationDocuments = Array.from({ length: 4 }, (_, index) =>
            document.implementation.createHTMLDocument(`destination-${index}`)
        );
        const addListeners = destinationDocuments.map((ownerDocument) => vi.spyOn(ownerDocument, "addEventListener"));
        const removeListeners = destinationDocuments.map((ownerDocument) =>
            vi.spyOn(ownerDocument, "removeEventListener")
        );

        for (const [index, ownerDocument] of destinationDocuments.slice(0, 3).entries()) {
            ownerDocument.body.append(textArea, toolbar);
            await flushMutationObserver();

            expect(getToolbarDocumentListenerTypes(addListeners[index].mock.calls)).toEqual(
                TOOLBAR_DOCUMENT_EVENT_TYPES
            );
            for (let staleIndex = 0; staleIndex < index; staleIndex += 1) {
                expect(getToolbarDocumentListenerTypes(removeListeners[staleIndex].mock.calls)).toEqual(
                    TOOLBAR_DOCUMENT_EVENT_TYPES
                );
            }
            expect(getToolbarDocumentListenerTypes(removeListeners[index].mock.calls)).toEqual([]);
        }
        expect(getToolbarDocumentListenerTypes(initialRemoveListener.mock.calls)).toEqual(TOOLBAR_DOCUMENT_EVENT_TYPES);

        const observeCountBeforeDisable = observeMutation.mock.calls.length;
        const disconnectCountBeforeDisable = disconnectMutation.mock.calls.length;
        fixture.setEnabled(false);

        expect(toolbar.isConnected).toBe(false);
        expect(getToolbarDocumentListenerTypes(removeListeners[2].mock.calls)).toEqual(TOOLBAR_ACTIVE_EVENT_TYPES);
        expect(observeMutation.mock.calls).toHaveLength(observeCountBeforeDisable);
        expect(disconnectMutation.mock.calls).toHaveLength(disconnectCountBeforeDisable + 1);

        fixture.setEnabled(true);
        textArea.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));

        expect(destinationDocuments[2].querySelector(TOOLBAR_SELECTOR)).toBe(toolbar);
        expect(getToolbarDocumentListenerTypes(addListeners[2].mock.calls)).toEqual([
            ...TOOLBAR_DOCUMENT_EVENT_TYPES,
            ...TOOLBAR_ACTIVE_EVENT_TYPES
        ]);

        destinationDocuments[3].body.append(textArea, toolbar);
        await flushMutationObserver();

        expect(destinationDocuments[3].querySelector(TOOLBAR_SELECTOR)).toBe(toolbar);
        expect(getToolbarDocumentListenerTypes(removeListeners[2].mock.calls)).toEqual([
            ...TOOLBAR_ACTIVE_EVENT_TYPES,
            ...TOOLBAR_DOCUMENT_EVENT_TYPES
        ]);
        expect(getToolbarDocumentListenerTypes(addListeners[3].mock.calls)).toEqual(TOOLBAR_DOCUMENT_EVENT_TYPES);

        fixture.setEnabled(false);
        expect(getToolbarDocumentListenerTypes(removeListeners[3].mock.calls)).toEqual(TOOLBAR_ACTIVE_EVENT_TYPES);

        fixture.dispose();
        fixture = undefined;
        expect(getToolbarDocumentListenerTypes(removeListeners[3].mock.calls)).toEqual([
            ...TOOLBAR_ACTIVE_EVENT_TYPES,
            "focusin"
        ]);
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
            [EDITOR_COMMAND_IDS.inlineCode, "Inline Code"],
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

        const styleTrigger = getMenuTrigger(toolbar, "style");
        expect(styleTrigger.textContent).toBe("Text");
        expect(styleTrigger.children).toHaveLength(3);
        expect(styleTrigger.firstElementChild?.innerHTML).toBe(createToolbarTextIcon().innerHTML);
        expect(styleTrigger.lastElementChild?.innerHTML).toBe(createToolbarCaretDownIcon().innerHTML);
        expect(styleTrigger.title).toBe("Style: Text");
        expect(styleTrigger.getAttribute("aria-label")).toBe("Style: Text");
        expect(getMenuPanel(toolbar, "style").getAttribute("aria-label")).toBe("Style");

        const styleCommands = registry.listCommands().filter(({ blockStyle }) => blockStyle !== undefined);
        for (const command of styleCommands) {
            const button = getCommandButton(toolbar, command.id);
            expect(button.textContent).toBe(command.label);
            expect(button.title).toBe(command.label);
            expect(button.getAttribute("aria-label")).toBe(command.label);
            expect(button.getAttribute("role")).toBe("menuitemradio");
            expect(button.hasAttribute("aria-checked")).toBe(true);
            expect(button.firstElementChild?.localName).toBe("svg");
            expect(button.lastElementChild?.textContent).toBe(command.label);
        }

        const moreTrigger = getMenuTrigger(toolbar, "more");
        expect(moreTrigger.textContent).toBe("More");
        expect(moreTrigger.firstElementChild?.localName).toBe("svg");
        expect(moreTrigger.lastElementChild?.textContent).toBe("More");
        expect(moreTrigger.title).toBe("More formatting commands");
        expect(moreTrigger.getAttribute("aria-label")).toBe("More formatting commands");
        const contributedButton = getCommandButton(toolbar, "contributed.command");
        expect(contributedButton.textContent).toBe("Contributed command");
        expect(contributedButton.getAttribute("role")).toBe("menuitem");
        expect(contributedButton.hasAttribute("aria-checked")).toBe(false);
        expect(contributedButton.querySelector("svg")?.innerHTML).toBe(
            createToolbarCommandIcon("contributed.command").innerHTML
        );

        const icons = toolbar.querySelectorAll(`svg.${TOOLBAR_ICON_CLASS}`);
        expect(icons).toHaveLength(toolbar.querySelectorAll("button").length + 1);
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
        expect(style?.textContent).toContain("__menu-separator");
        expect(style?.textContent).toContain("align-self: stretch !important");
        expect(style?.textContent).toContain("border-top: 1px solid #8c959f !important");
        expect(style?.textContent).toContain("border-top-color: CanvasText !important");
        expect(style?.textContent).toContain("__menu-item--active");
        expect(style?.textContent).toContain("background: #dbeafe");
        expect(style?.textContent).toContain("background: Highlight");
        expect(style?.textContent).toContain("color: HighlightText");
        expect(style?.textContent).toContain(`
    .tampermonkey-markdown-enhancer-formatting-toolbar__menu-panel .tampermonkey-markdown-enhancer-formatting-toolbar__menu-item--active[aria-disabled="true"] {
        background: Highlight !important;
        border-color: Highlight !important;
        color: HighlightText !important;
        opacity: 1 !important;
    }
`);
    });

    test("does not execute a toolbar command for an already-defaultPrevented click", () => {
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
        const pageClick = vi.fn((event: MouseEvent) => event.preventDefault());
        const documentClick = vi.fn();
        boldButton.addEventListener("click", pageClick);
        document.addEventListener("click", documentClick);
        const clickEvent = new MouseEvent("click", { bubbles: true, cancelable: true });
        try {
            boldButton.dispatchEvent(clickEvent);
        } finally {
            document.removeEventListener("click", documentClick);
        }

        expect(clickEvent.defaultPrevented).toBe(true);
        expect(pageClick).toHaveBeenCalledOnce();
        expect(documentClick).toHaveBeenCalledOnce();
        expect(executeCommand).not.toHaveBeenCalled();
        expect(textArea.value).toBe("selected");
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

    test.each(["style", "more"] as const)(
        "releases a focused %s row and reconciles editor state after an outside nonfocusable pointer",
        async (menuName) => {
            const registry =
                menuName === "more"
                    ? createCommandRegistry([
                          {
                              id: "custom.action",
                              label: "Custom action",
                              isAvailable: () => true,
                              execute: () => true
                          }
                      ])
                    : createCommandRegistry();
            fixture = createFixture(registry);
            const firstEditor = createTextArea();
            firstEditor.focus();
            const destinationEditor = createTextArea();
            destinationEditor.value = "plain";
            destinationEditor.setSelectionRange(0, 0);
            const outsideTarget = document.createElement("span");
            outsideTarget.textContent = "Outside";
            document.body.append(outsideTarget);
            const toolbar = fixture.getToolbar();
            if (!toolbar) {
                throw new Error("Expected toolbar");
            }
            const panel = menuName === "style" ? openStylePanel(toolbar) : openMorePanel(toolbar);
            const focusedRow = document.activeElement;
            const trigger = getMenuTrigger(toolbar, menuName);
            expect(focusedRow instanceof HTMLButtonElement && panel.contains(focusedRow)).toBe(true);
            let activeElementDuringPageHandler: Element | null = null;
            const handlePagePointerDown = vi.fn(() => {
                activeElementDuringPageHandler = document.activeElement;
                destinationEditor.focus();
                destinationEditor.value = "# Heading";
                destinationEditor.setSelectionRange(2, 2);
            });
            outsideTarget.addEventListener("pointerdown", handlePagePointerDown);

            const event = dispatchPointerDown(outsideTarget);

            expect(panel.hidden).toBe(true);
            expect(event.defaultPrevented).toBe(false);
            expect(event.cancelBubble).toBe(false);
            expect(handlePagePointerDown).toHaveBeenCalledOnce();
            expect(activeElementDuringPageHandler).not.toBe(focusedRow);
            expect(activeElementDuringPageHandler).not.toBe(trigger);
            expect(document.activeElement).toBe(destinationEditor);
            expect(destinationEditor.nextSibling).toBe(toolbar);
            expect(getStyleTrigger(toolbar).textContent).toBe("Text");

            await Promise.resolve();

            expect(getStyleTrigger(toolbar).textContent).toBe("Heading 1");
        }
    );

    test("dismisses Style menu for primary mouse, touch, and pen pointers without consuming page behavior", () => {
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
            const panel = openStylePanel(toolbar);
            const event = dispatchPointerDown(pageControl, { pointerType });

            expect(panel.hidden).toBe(true);
            expect(getStyleTrigger(toolbar).getAttribute("aria-expanded")).toBe("false");
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

        const panel = openStylePanel(toolbar);
        const nonPrimaryEvent = dispatchPointerDown(pageControl, { isPrimary: false, pointerType: "pen" });
        expect(nonPrimaryEvent.defaultPrevented).toBe(false);
        expect(panel.hidden).toBe(false);

        const triggerTarget = getStyleTrigger(toolbar).querySelector("svg");
        const panelTarget = panel.querySelector("button svg");
        if (!triggerTarget || !panelTarget) {
            throw new Error("Expected nested Style menu targets");
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

            const panel = openStylePanel(toolbar);
            const triggerTarget = getStyleTrigger(toolbar).querySelector("path");
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
            openStylePanel(toolbar);
            const activeElementBeforeOuterPointer = outerRoot.activeElement;

            const outerOutsideEvent = dispatchPointerDown(outerOutsideTarget, pointerOptions);

            expect(panel.hidden).toBe(true);
            expect(outerOutsideEvent.defaultPrevented).toBe(false);
            expect(outerOutsideEvent.cancelBubble).toBe(false);
            expect(handleOuterPointerDown).toHaveBeenCalledOnce();
            expect(outerRoot.activeElement).not.toBe(activeElementBeforeOuterPointer);
            expect(innerRoot.activeElement).toBeNull();

            openStylePanel(toolbar);
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
    ])("keeps Style menu open for %s mouse activation", (_buttonName, button) => {
        fixture = createFixture();
        const textArea = createTextArea();
        textArea.focus();
        const toolbar = fixture.getToolbar();
        if (!toolbar) {
            throw new Error("Expected toolbar");
        }
        const pageControl = document.createElement("button");
        document.body.append(pageControl);
        const panel = openStylePanel(toolbar);

        const event = dispatchPointerDown(pageControl, { button });

        expect(panel.hidden).toBe(false);
        expect(getStyleTrigger(toolbar).getAttribute("aria-expanded")).toBe("true");
        expect(event.defaultPrevented).toBe(false);
        expect(event.cancelBubble).toBe(false);
    });

    test.each(["touch", "pen"] as const)("keeps Style menu open for a non-primary %s pointer", (pointerType) => {
        fixture = createFixture();
        const textArea = createTextArea();
        textArea.focus();
        const toolbar = fixture.getToolbar();
        if (!toolbar) {
            throw new Error("Expected toolbar");
        }
        const pageControl = document.createElement("button");
        document.body.append(pageControl);
        const panel = openStylePanel(toolbar);

        const event = dispatchPointerDown(pageControl, { isPrimary: false, pointerType });

        expect(panel.hidden).toBe(false);
        expect(getStyleTrigger(toolbar).getAttribute("aria-expanded")).toBe("true");
        expect(event.defaultPrevented).toBe(false);
        expect(event.cancelBubble).toBe(false);
    });

    test.each([
        ["isPrimary", { isPrimaryDefined: false }],
        ["button", { isButtonDefined: false }],
        ["both activation properties", { isButtonDefined: false, isPrimaryDefined: false }]
    ] satisfies ReadonlyArray<readonly [string, PointerDownOptions]>)(
        "dismisses Style menu with missing %s",
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
            const panel = openStylePanel(toolbar);

            const event = dispatchPointerDown(pageControl, pointerOptions);

            expect(panel.hidden).toBe(true);
            expect(getStyleTrigger(toolbar).getAttribute("aria-expanded")).toBe("false");
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

        currentPanel = openStylePanel(toolbar);
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
        currentPanel = openStylePanel(toolbar);
        const styleButton = currentPanel.querySelector<HTMLButtonElement>("button:not(:disabled)");
        const commandId = styleButton?.dataset.commandId;
        if (!styleButton || !commandId) {
            throw new Error("Expected enabled Style menu command");
        }

        dispatchPointerDown(styleButton, { pointerType: "touch" });
        expect(currentPanel.hidden).toBe(false);
        styleButton.click();

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

        const panel = openStylePanel(toolbar);
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

        dispatchKeyboardEvent(getStyleTrigger(toolbar), "ArrowDown");
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

        const panel = openStylePanel(toolbar);
        newRoot.append(textArea, toolbar);
        await flushMutationObserver();

        expect(panel.hidden).toBe(true);
        const relocatedPanel = getStylePanel(toolbar);
        expect(relocatedPanel.hidden).toBe(false);
        expect(newRoot.activeElement).toBe(relocatedPanel.querySelector('button[data-block-style="text"]'));
        expect(getPointerListenerCalls(documentAddListener.mock.calls)).toHaveLength(2);
        expect(getPointerListenerCalls(oldRootAddListener.mock.calls)).toHaveLength(1);
        expect(getPointerListenerCalls(newRootAddListener.mock.calls)).toHaveLength(1);
        expect(getPointerListenerCalls(documentRemoveListener.mock.calls)).toHaveLength(1);
        expect(getPointerListenerCalls(oldRootRemoveListener.mock.calls)).toHaveLength(1);
        expect(getPointerListenerCalls(newRootRemoveListener.mock.calls)).toHaveLength(0);

        getStyleTrigger(toolbar).click();
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

        const firstPanel = openStylePanel(toolbar);
        secondEditor.focus();
        expect(firstPanel.hidden).toBe(true);
        expect(getPointerListenerCalls(removeListener.mock.calls)).toHaveLength(1);

        const secondPanel = openStylePanel(toolbar);
        const relocatedRow = secondPanel.querySelector<HTMLButtonElement>('button[data-block-style="heading2"]');
        relocatedRow?.focus();
        secondEditor.dataset.toolbarPlacement = "before-editor";
        secondEditor.dispatchEvent(new InputEvent("input", { bubbles: true }));
        expect(secondPanel.hidden).toBe(false);
        expect(secondEditor.previousSibling).toBe(toolbar);
        expect(document.activeElement).toBe(relocatedRow);
        expect(getPointerListenerCalls(removeListener.mock.calls)).toHaveLength(2);
        dispatchKeyboardEvent(relocatedRow as HTMLButtonElement, "Escape");

        const thirdPanel = openStylePanel(toolbar);
        thirdPanel.querySelector<HTMLButtonElement>('button[data-block-style="heading4"]')?.focus();
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
        const rerenderedPanel = getStylePanel(toolbar);
        expect(thirdPanel.hidden).toBe(true);
        expect(rerenderedPanel.hidden).toBe(false);
        expect(document.activeElement).toBe(
            rerenderedPanel.querySelector<HTMLButtonElement>('button[data-block-style="heading4"]')
        );
        expect(toolbar.querySelector('button[data-command-id="custom.rerender"]')).not.toBeNull();
        expect(getPointerListenerCalls(removeListener.mock.calls)).toHaveLength(4);
        expect(getPointerListenerCalls(addListener.mock.calls)).toHaveLength(5);
    });

    test("moves focus to the More trigger when a focused contributed action is removed", () => {
        const registry = createCommandRegistry([
            {
                id: "custom.first",
                label: "First action",
                isAvailable: () => true,
                execute: () => true
            },
            {
                id: "custom.second",
                label: "Second action",
                isAvailable: () => true,
                execute: () => true
            }
        ]);
        fixture = createFixture(registry);
        const textArea = createTextArea();
        textArea.focus();
        const toolbar = fixture.getToolbar();
        if (!toolbar) {
            throw new Error("Expected toolbar");
        }
        const originalPanel = openMorePanel(toolbar);
        const removedButton = getCommandButton(toolbar, "custom.first");
        removedButton.focus();
        const remainingCommands = registry.listCommands().filter(({ id }) => id !== "custom.first");
        vi.spyOn(registry, "listCommands").mockReturnValue(remainingCommands);

        textArea.dispatchEvent(new InputEvent("input", { bubbles: true }));

        const replacementPanel = getMenuPanel(toolbar, "more");
        const replacementTrigger = getMenuTrigger(toolbar, "more");
        expect(originalPanel.hidden).toBe(true);
        expect(removedButton.isConnected).toBe(false);
        expect(replacementPanel.hidden).toBe(true);
        expect(replacementTrigger.getAttribute("aria-expanded")).toBe("false");
        expect(getCommandButton(toolbar, "custom.second").isConnected).toBe(true);
        expect(document.activeElement).toBe(replacementTrigger);
        expect(toolbar.contains(document.activeElement)).toBe(true);
    });

    test("moves focus to Style when removing the focused last More action omits More", () => {
        const registry = createCommandRegistry([
            {
                id: "custom.only",
                label: "Only action",
                isAvailable: () => true,
                execute: () => true
            }
        ]);
        fixture = createFixture(registry);
        const textArea = createTextArea();
        textArea.focus();
        const toolbar = fixture.getToolbar();
        if (!toolbar) {
            throw new Error("Expected toolbar");
        }
        const originalPanel = openMorePanel(toolbar);
        const removedButton = getCommandButton(toolbar, "custom.only");
        removedButton.focus();
        const coreCommands = registry.listCommands().filter(({ id }) => id !== "custom.only");
        vi.spyOn(registry, "listCommands").mockReturnValue(coreCommands);

        textArea.dispatchEvent(new InputEvent("input", { bubbles: true }));

        const styleTrigger = getStyleTrigger(toolbar);
        expect(originalPanel.hidden).toBe(true);
        expect(removedButton.isConnected).toBe(false);
        expect(toolbar.querySelector('[data-toolbar-menu-trigger="more"]')).toBeNull();
        expect(toolbar.querySelector('[data-toolbar-menu="more"]')).toBeNull();
        expect(getStylePanel(toolbar).hidden).toBe(true);
        expect(styleTrigger.getAttribute("aria-expanded")).toBe("false");
        expect(document.activeElement).toBe(styleTrigger);
        expect(toolbar.contains(document.activeElement)).toBe(true);
    });

    test("preserves focused More action and open menu state when that action survives a rerender", () => {
        const registry = createCommandRegistry([
            {
                id: "custom.removed",
                label: "Removed action",
                isAvailable: () => true,
                execute: () => true
            },
            {
                id: "custom.preserved",
                label: "Preserved action",
                isAvailable: () => true,
                execute: () => true
            }
        ]);
        fixture = createFixture(registry);
        const textArea = createTextArea();
        textArea.focus();
        const toolbar = fixture.getToolbar();
        if (!toolbar) {
            throw new Error("Expected toolbar");
        }
        const originalPanel = openMorePanel(toolbar);
        const originalButton = getCommandButton(toolbar, "custom.preserved");
        originalButton.focus();
        const remainingCommands = registry.listCommands().filter(({ id }) => id !== "custom.removed");
        vi.spyOn(registry, "listCommands").mockReturnValue(remainingCommands);

        textArea.dispatchEvent(new InputEvent("input", { bubbles: true }));

        const replacementPanel = getMenuPanel(toolbar, "more");
        const replacementButton = getCommandButton(toolbar, "custom.preserved");
        expect(originalPanel.hidden).toBe(true);
        expect(originalButton.isConnected).toBe(false);
        expect(replacementPanel.hidden).toBe(false);
        expect(getMenuTrigger(toolbar, "more").getAttribute("aria-expanded")).toBe("true");
        expect(replacementButton).not.toBe(originalButton);
        expect(document.activeElement).toBe(replacementButton);
        expect(toolbar.contains(document.activeElement)).toBe(true);
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

        openStylePanel(toolbar);
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
        openStylePanel(restoredToolbar);
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
        openStylePanel(remountedToolbar);
        fixture.dispose();
        expect(fixture.getToolbar()).toBeNull();
        expect(getPointerListenerCalls(removeListener.mock.calls)).toHaveLength(3);
        expect(getPointerListenerCalls(addListener.mock.calls)).toHaveLength(3);
        fixture = undefined;
    });

    test("ignores a delayed select event from an editor that is no longer active", () => {
        fixture = createFixture();
        const firstEditor = createTextArea();
        const secondEditor = createTextArea();
        firstEditor.focus();
        const toolbar = fixture.getToolbar();
        if (!toolbar) {
            throw new Error("Expected toolbar");
        }

        secondEditor.focus();
        expect(secondEditor.nextSibling).toBe(toolbar);
        firstEditor.dispatchEvent(new Event("select", { bubbles: true }));

        expect(secondEditor.nextSibling).toBe(toolbar);
        expect(firstEditor.nextSibling).not.toBe(toolbar);
    });

    test("preserves the pre-open selection through host focusout and Style pointer execution", async () => {
        fixture = createFixture();
        const textArea = createTextArea();
        textArea.value = "first\nsecond";
        textArea.setSelectionRange(0, textArea.value.length);
        textArea.focus();
        const toolbar = fixture.getToolbar();
        if (!toolbar) {
            throw new Error("Expected toolbar");
        }
        textArea.addEventListener("focusout", () => textArea.setSelectionRange(0, 0), { once: true });

        const panel = openStylePanel(toolbar);
        expect([textArea.selectionStart, textArea.selectionEnd]).toEqual([0, 0]);
        await flushMutationObserver();
        const headingButton = panel.querySelector<HTMLButtonElement>('button[data-block-style="heading1"]');
        if (!headingButton) {
            throw new Error("Expected Heading 1 row");
        }
        dispatchPointerDown(headingButton);
        headingButton.click();

        expect(textArea.value).toBe("# first\n# second");
        expect([textArea.selectionStart, textArea.selectionEnd]).toEqual([2, 16]);
        expect(document.activeElement).toBe(textArea);
    });

    test("refreshes immediately for non-composed ShadowRoot selectionchange and rebinds without duplicates", async () => {
        fixture = createFixture();
        const firstHost = document.createElement("div");
        const firstRoot = firstHost.attachShadow({ mode: "open" });
        const secondHost = document.createElement("div");
        const secondRoot = secondHost.attachShadow({ mode: "open" });
        const firstAddListener = vi.spyOn(firstRoot, "addEventListener");
        const firstRemoveListener = vi.spyOn(firstRoot, "removeEventListener");
        const secondAddListener = vi.spyOn(secondRoot, "addEventListener");
        const secondRemoveListener = vi.spyOn(secondRoot, "removeEventListener");
        const textArea = document.createElement("textarea");
        textArea.dataset.toolbarPlacement = "after-editor";
        textArea.dataset.isSupportedEditor = "true";
        textArea.value = "plain";
        textArea.setSelectionRange(0, 0);
        firstRoot.append(textArea);
        document.body.append(firstHost, secondHost);
        textArea.focus();
        const toolbar = firstRoot.querySelector<HTMLElement>(TOOLBAR_SELECTOR);
        if (!toolbar) {
            throw new Error("Expected ShadowRoot toolbar");
        }
        const trigger = getStyleTrigger(toolbar);
        expect(firstAddListener.mock.calls.filter(([type]) => type === "selectionchange")).toHaveLength(1);

        textArea.value = "# Heading";
        textArea.setSelectionRange(2, 2);
        textArea.dispatchEvent(new Event("selectionchange", { bubbles: true, composed: false }));
        expect(trigger.textContent).toBe("Heading 1");

        secondRoot.append(textArea, toolbar);
        textArea.focus();
        await flushMutationObserver();
        expect(firstRemoveListener.mock.calls.filter(([type]) => type === "selectionchange")).toHaveLength(1);
        expect(secondAddListener.mock.calls.filter(([type]) => type === "selectionchange")).toHaveLength(1);

        textArea.value = "> Quote";
        textArea.setSelectionRange(2, 2);
        textArea.dispatchEvent(new Event("selectionchange", { bubbles: true, composed: false }));
        expect(getStyleTrigger(toolbar).textContent).toBe("Blockquote");
        expect(secondAddListener.mock.calls.filter(([type]) => type === "selectionchange")).toHaveLength(1);

        fixture.dispose();
        fixture = undefined;
        expect(secondRemoveListener.mock.calls.filter(([type]) => type === "selectionchange")).toHaveLength(1);
    });

    test("restores settings-closed Style and More panels to their own triggers", () => {
        fixture = createFixture(
            createCommandRegistry([
                {
                    id: "custom.action",
                    label: "Custom action",
                    isAvailable: () => true,
                    execute: () => true
                }
            ])
        );
        const textArea = createTextArea();
        textArea.focus();
        const toolbar = fixture.getToolbar();
        if (!toolbar) {
            throw new Error("Expected toolbar");
        }

        const stylePanel = openStylePanel(toolbar);
        expect(stylePanel.contains(document.activeElement)).toBe(true);
        fixture.setEnabled(true);
        expect(stylePanel.hidden).toBe(true);
        expect(document.activeElement).toBe(getMenuTrigger(toolbar, "style"));

        const morePanel = openMorePanel(toolbar);
        expect(morePanel.contains(document.activeElement)).toBe(true);
        fixture.setEnabled(true);
        expect(morePanel.hidden).toBe(true);
        expect(document.activeElement).toBe(getMenuTrigger(toolbar, "more"));
    });

    test("focuses the checked unavailable Style row and includes it in inert composite navigation", () => {
        const registry = createCommandRegistry();
        const getCommand = registry.getCommand.bind(registry);
        vi.spyOn(registry, "getCommand").mockImplementation((id) => {
            const command = getCommand(id);
            return command?.blockStyle === "heading1" ? { ...command, isAvailable: () => false } : command;
        });
        const executeCommand = vi.spyOn(registry, "executeCommand");
        fixture = createFixture(registry);
        const textArea = createTextArea();
        textArea.value = "# Heading";
        textArea.setSelectionRange(2, 2);
        textArea.focus();
        const toolbar = fixture.getToolbar();
        if (!toolbar) {
            throw new Error("Expected toolbar");
        }

        const panel = openStylePanel(toolbar);
        const headingButton = getCommandButton(toolbar, EDITOR_COMMAND_IDS.heading1);
        const nextButton = getCommandButton(toolbar, EDITOR_COMMAND_IDS.heading2);
        expect(headingButton.disabled).toBe(false);
        expect(headingButton.getAttribute("aria-disabled")).toBe("true");
        expect(headingButton.getAttribute("aria-checked")).toBe("true");
        expect(document.activeElement).toBe(headingButton);

        const enterEvent = dispatchKeyboardEvent(headingButton, "Enter");
        expect(enterEvent.defaultPrevented).toBe(true);
        headingButton.click();
        expect(executeCommand).not.toHaveBeenCalled();
        expect(textArea.value).toBe("# Heading");
        expect(panel.hidden).toBe(false);

        headingButton.focus();
        dispatchKeyboardEvent(headingButton, "ArrowDown");
        expect(document.activeElement).toBe(nextButton);
        dispatchKeyboardEvent(nextButton, "ArrowUp");
        expect(document.activeElement).toBe(headingButton);
    });

    test.each([
        ["document", "readonly"],
        ["document", "disabled"],
        ["ShadowRoot", "readonly"],
        ["ShadowRoot", "disabled"]
    ] as const)("removes the active %s toolbar when the textarea reflects %s", async (rootKind, attribute) => {
        fixture = createFixture();
        const host = rootKind === "ShadowRoot" ? document.createElement("div") : undefined;
        const root = host?.attachShadow({ mode: "open" });
        const textArea = root ? document.createElement("textarea") : createTextArea();
        if (root && host) {
            textArea.dataset.toolbarPlacement = "after-editor";
            textArea.dataset.isSupportedEditor = "true";
            root.append(textArea);
            document.body.append(host);
        }
        textArea.focus();
        expect((root ?? document).querySelector(TOOLBAR_SELECTOR)).not.toBeNull();

        if (attribute === "readonly") {
            textArea.readOnly = true;
        } else {
            textArea.disabled = true;
        }
        expect(textArea.hasAttribute(attribute)).toBe(true);
        await flushMutationObserver();

        expect((root ?? document).querySelector(TOOLBAR_SELECTOR)).toBeNull();
    });

    test("revalidates menu IDs when an existing host element gains a colliding ID", async () => {
        fixture = createFixture();
        const textArea = createTextArea();
        const collision = document.createElement("div");
        document.body.append(collision);
        textArea.focus();
        const toolbar = fixture.getToolbar();
        if (!toolbar) {
            throw new Error("Expected toolbar");
        }
        const originalPanel = getMenuPanel(toolbar, "style");
        const originalTrigger = getStyleTrigger(toolbar);
        originalTrigger.focus();

        collision.id = originalPanel.id;
        await flushMutationObserver();

        const replacementPanel = getMenuPanel(toolbar, "style");
        expect(replacementPanel).not.toBe(originalPanel);
        expect(replacementPanel.id).not.toBe(collision.id);
        expect(document.querySelectorAll(`[id="${collision.id}"]`)).toHaveLength(1);
        const replacementTrigger = getMenuTrigger(toolbar, "style");
        expect(replacementTrigger.getAttribute("aria-controls")).toBe(replacementPanel.id);
        expect(replacementTrigger.isConnected).toBe(true);
        expect(document.activeElement).toBe(replacementTrigger);
    });
});
