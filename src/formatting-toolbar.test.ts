import { afterEach, describe, expect, test, vi } from "vitest";
import { CONCRETE_BLOCK_STYLES } from "./block-styles";
import { collectColorSchemeSignalElements } from "./color-scheme";
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
    readonly getResolverCallCount: () => number;
    readonly getToolbar: () => HTMLElement | null;
    readonly setEnabled: (isEnabled: boolean) => void;
    readonly setRegistry: (registry: EditorCommandRegistry) => void;
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
    let activeRegistry = registry;
    let resolverCallCount = 0;
    const listeners = new Set<() => void>();
    const notifySettings = (): void => {
        for (const listener of listeners) {
            listener();
        }
    };
    const resolveEditorFromTextArea = (textArea: HTMLTextAreaElement): FormattingToolbarEditor | null => {
        resolverCallCount += 1;
        return resolveFixtureEditor(textArea, activeRegistry, isEnabled);
    };
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
        getResolverCallCount: () => resolverCallCount,
        getToolbar: () => document.querySelector<HTMLElement>(TOOLBAR_SELECTOR),
        setEnabled: (isNextEnabled) => {
            isEnabled = isNextEnabled;
            notifySettings();
        },
        setRegistry: (nextRegistry) => {
            activeRegistry = nextRegistry;
            notifySettings();
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

const getStyleSheetLoadListenerCalls = (calls: readonly (readonly unknown[])[]): ReadonlyArray<readonly unknown[]> =>
    calls.filter(([type, , options]) => type === "load" && options === true);

const getSlotChangeListenerCalls = (calls: readonly (readonly unknown[])[]): ReadonlyArray<readonly unknown[]> =>
    calls.filter(([type]) => type === "slotchange");

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

const calculateRelativeLuminance = (hexColor: string): number => {
    const channels = hexColor
        .slice(1)
        .match(/.{2}/g)
        ?.map((channel) => Number.parseInt(channel, 16) / 255);
    if (!channels || channels.length !== 3) {
        throw new Error(`Expected six-digit hex color, received ${hexColor}`);
    }
    const [red, green, blue] = channels.map((channel) =>
        channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
    );
    return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
};

const calculateContrastRatio = (firstColor: string, secondColor: string): number => {
    const firstLuminance = calculateRelativeLuminance(firstColor);
    const secondLuminance = calculateRelativeLuminance(secondColor);
    const lighterLuminance = Math.max(firstLuminance, secondLuminance);
    const darkerLuminance = Math.min(firstLuminance, secondLuminance);
    return (lighterLuminance + 0.05) / (darkerLuminance + 0.05);
};

const readColorTokens = (css: string, scheme: "light" | "dark"): ReadonlyMap<string, string> => {
    const blockMarker = `[data-tampermonkey-markdown-enhancer-color-scheme="${scheme}"] {`;
    const blockStart = css.indexOf(blockMarker);
    const blockEnd = css.indexOf("}", blockStart);
    if (blockStart < 0 || blockEnd < 0) {
        throw new Error(`Missing ${scheme} color-scheme block`);
    }
    return new Map(
        Array.from(
            css.slice(blockStart, blockEnd).matchAll(/(--tme-[\w-]+):\s*(#[\da-f]{6});/gi),
            ([, name, value]) => [name, value.toLowerCase()]
        )
    );
};

const getColorToken = (tokens: ReadonlyMap<string, string>, tokenName: string): string => {
    const color = tokens.get(tokenName);
    if (!color) {
        throw new Error(`Missing color token ${tokenName}`);
    }
    return color;
};

interface MediaPreferenceFixture {
    readonly addEventListener: ReturnType<typeof vi.fn>;
    readonly addListener: ReturnType<typeof vi.fn>;
    readonly matchMedia: ReturnType<typeof vi.fn>;
    readonly mediaQueryList: MediaQueryList;
    readonly removeEventListener: ReturnType<typeof vi.fn>;
    readonly removeListener: ReturnType<typeof vi.fn>;
    readonly restore: () => void;
    readonly setMatches: (isMatched: boolean) => void;
}

interface MediaPreferenceFixtureOptions {
    readonly getIsLegacyAddThrowing?: () => boolean;
    readonly getIsLegacyRemoveThrowing?: () => boolean;
    readonly getIsModernAddThrowing?: () => boolean;
    readonly getIsModernRemoveThrowing?: () => boolean;
    readonly isLegacyAddMutatingBeforeThrow?: boolean;
    readonly isLegacyAddThrowing?: boolean;
    readonly isLegacyRemoveThrowing?: boolean;
    readonly isLegacyRemoveUnavailable?: boolean;
    readonly isModernAddMutatingBeforeThrow?: boolean;
    readonly isModernAddThrowing?: boolean;
    readonly isModernRemoveThrowing?: boolean;
    readonly isModernRemoveUnavailable?: boolean;
}

const createMediaPreferenceFixture = (
    ownerWindow: Window,
    isInitiallyMatched: boolean,
    options: MediaPreferenceFixtureOptions = {}
): MediaPreferenceFixture => {
    const listeners = new Set<(event: MediaQueryListEvent) => void>();
    const originalDescriptor = Object.getOwnPropertyDescriptor(ownerWindow, "matchMedia");
    const state = { isMatched: isInitiallyMatched };
    const addEventListener = vi.fn((type: string, listener: EventListenerOrEventListenerObject) => {
        const isChangeListener = type === "change" && typeof listener === "function";
        const isAddThrowing = options.isModernAddThrowing || options.getIsModernAddThrowing?.() === true;
        if (isChangeListener && (!isAddThrowing || options.isModernAddMutatingBeforeThrow)) {
            listeners.add(listener as (event: MediaQueryListEvent) => void);
        }
        if (isAddThrowing) {
            throw new Error("modern add failed");
        }
    });
    const removeEventListener = vi.fn((type: string, listener: EventListenerOrEventListenerObject) => {
        const isRemoveThrowing = options.isModernRemoveThrowing || options.getIsModernRemoveThrowing?.() === true;
        if (isRemoveThrowing) {
            throw new Error("modern remove failed");
        }
        if (type === "change" && typeof listener === "function") {
            listeners.delete(listener as (event: MediaQueryListEvent) => void);
        }
    });
    const addListener = vi.fn((listener: (event: MediaQueryListEvent) => void) => {
        const isAddThrowing = options.isLegacyAddThrowing || options.getIsLegacyAddThrowing?.() === true;
        if (!isAddThrowing || options.isLegacyAddMutatingBeforeThrow) {
            listeners.add(listener);
        }
        if (isAddThrowing) {
            throw new Error("legacy add failed");
        }
    });
    const removeListener = vi.fn((listener: (event: MediaQueryListEvent) => void) => {
        const isRemoveThrowing = options.isLegacyRemoveThrowing || options.getIsLegacyRemoveThrowing?.() === true;
        if (isRemoveThrowing) {
            throw new Error("legacy remove failed");
        }
        listeners.delete(listener);
    });
    const mediaQueryList = {
        addEventListener,
        addListener,
        dispatchEvent: vi.fn(),
        get matches() {
            return state.isMatched;
        },
        media: "(prefers-color-scheme: dark)",
        onchange: null,
        removeEventListener: options.isModernRemoveUnavailable ? undefined : removeEventListener,
        removeListener: options.isLegacyRemoveUnavailable ? undefined : removeListener
    } as unknown as MediaQueryList;
    const matchMedia = vi.fn(() => mediaQueryList);
    Object.defineProperty(ownerWindow, "matchMedia", {
        configurable: true,
        value: matchMedia
    });
    return {
        addEventListener,
        addListener,
        matchMedia,
        mediaQueryList,
        removeEventListener,
        removeListener,
        restore: () => {
            if (originalDescriptor) {
                Object.defineProperty(ownerWindow, "matchMedia", originalDescriptor);
            } else {
                Reflect.deleteProperty(ownerWindow, "matchMedia");
            }
        },
        setMatches: (isMatched) => {
            state.isMatched = isMatched;
            const event = { matches: isMatched, media: mediaQueryList.media } as MediaQueryListEvent;
            for (const listener of listeners) {
                listener(event);
            }
        }
    };
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

    test("keeps observer registrations stable for same-editor state events", async () => {
        const observeMutation = vi.spyOn(MutationObserver.prototype, "observe");
        const disconnectMutation = vi.spyOn(MutationObserver.prototype, "disconnect");
        fixture = createFixture();
        const textArea = createTextArea();
        textArea.value = "value";
        textArea.setSelectionRange(0, textArea.value.length);
        textArea.focus();
        const toolbar = fixture.getToolbar();
        if (!toolbar) {
            throw new Error("Expected toolbar");
        }
        await flushMutationObserver();
        const observeCallCount = observeMutation.mock.calls.length;
        const disconnectCallCount = disconnectMutation.mock.calls.length;

        textArea.dispatchEvent(new InputEvent("input", { bubbles: true }));
        textArea.dispatchEvent(new Event("select", { bubbles: true }));
        textArea.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, key: "e" }));
        document.dispatchEvent(new Event("selectionchange"));
        await Promise.resolve();

        expect(fixture.getToolbar()).toBe(toolbar);
        expect(observeMutation.mock.calls).toHaveLength(observeCallCount);
        expect(disconnectMutation.mock.calls).toHaveLength(disconnectCallCount);
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

    test("updates media fallback without remounting or disturbing menu, focus, and selection", () => {
        const media = createMediaPreferenceFixture(window, false);
        try {
            fixture = createFixture();
            const textArea = createTextArea();
            textArea.value = "# Heading";
            textArea.setSelectionRange(0, textArea.value.length, "backward");
            textArea.focus();
            const toolbar = fixture.getToolbar();
            if (!toolbar) {
                throw new Error("Expected toolbar");
            }
            expect(toolbar.dataset.tampermonkeyMarkdownEnhancerColorScheme).toBe("light");
            expect(media.addEventListener).toHaveBeenCalledOnce();

            const panel = openStylePanel(toolbar);
            const focusedRow = panel.querySelector<HTMLButtonElement>('button[data-block-style="heading2"]');
            if (!focusedRow) {
                throw new Error("Expected style row");
            }
            focusedRow.focus();
            const selection = [textArea.selectionStart, textArea.selectionEnd, textArea.selectionDirection];

            media.setMatches(true);

            expect(fixture.getToolbar()).toBe(toolbar);
            expect(getStylePanel(toolbar)).toBe(panel);
            expect(panel.hidden).toBe(false);
            expect(document.activeElement).toBe(focusedRow);
            expect([textArea.selectionStart, textArea.selectionEnd, textArea.selectionDirection]).toEqual(selection);
            expect(toolbar.dataset.tampermonkeyMarkdownEnhancerColorScheme).toBe("dark");
            expect(media.addEventListener).toHaveBeenCalledOnce();

            media.setMatches(false);
            expect(toolbar.dataset.tampermonkeyMarkdownEnhancerColorScheme).toBe("light");

            fixture.dispose();
            fixture = undefined;
            expect(media.removeEventListener).toHaveBeenCalledOnce();
            expect(media.removeEventListener.mock.calls[0]?.[1]).toBe(media.addEventListener.mock.calls[0]?.[1]);
            expect(media.addListener).not.toHaveBeenCalled();
            expect(media.removeListener).not.toHaveBeenCalled();
            media.setMatches(true);
            expect(toolbar.isConnected).toBe(false);
        } finally {
            media.restore();
        }
    });

    test("cleans a partially added modern media listener before registering the legacy fallback", () => {
        const media = createMediaPreferenceFixture(window, false, {
            isModernAddMutatingBeforeThrow: true,
            isModernAddThrowing: true
        });
        try {
            fixture = createFixture();
            const textArea = createTextArea();
            expect(() => textArea.focus()).not.toThrow();
            const toolbar = fixture.getToolbar();
            if (!toolbar) {
                throw new Error("Expected toolbar");
            }

            expect(media.addEventListener).toHaveBeenCalledOnce();
            expect(media.removeEventListener).toHaveBeenCalledOnce();
            expect(media.removeEventListener.mock.calls[0]?.[1]).toBe(media.addEventListener.mock.calls[0]?.[1]);
            expect(media.addListener).toHaveBeenCalledOnce();
            expect(media.removeEventListener.mock.invocationCallOrder[0]).toBeLessThan(
                media.addListener.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY
            );
            media.setMatches(true);
            expect(toolbar.dataset.tampermonkeyMarkdownEnhancerColorScheme).toBe("dark");

            fixture.dispose();
            fixture = undefined;
            expect(media.removeEventListener).toHaveBeenCalledOnce();
            expect(media.removeListener).toHaveBeenCalledOnce();
            expect(media.removeListener.mock.calls[0]?.[0]).toBe(media.addListener.mock.calls[0]?.[0]);
        } finally {
            media.restore();
        }
    });

    test("uses the complete legacy media pair when modern removal is unavailable", () => {
        const media = createMediaPreferenceFixture(window, false, { isModernRemoveUnavailable: true });
        try {
            fixture = createFixture();
            const textArea = createTextArea();
            expect(() => textArea.focus()).not.toThrow();

            expect(media.addEventListener).not.toHaveBeenCalled();
            expect(media.addListener).toHaveBeenCalledOnce();
            fixture.dispose();
            fixture = undefined;
            expect(media.removeEventListener).not.toHaveBeenCalled();
            expect(media.removeListener).toHaveBeenCalledOnce();
            expect(media.removeListener.mock.calls[0]?.[0]).toBe(media.addListener.mock.calls[0]?.[0]);
        } finally {
            media.restore();
        }
    });

    test("does not register a media listener when neither API has a complete pair", () => {
        const media = createMediaPreferenceFixture(window, true, {
            isLegacyRemoveUnavailable: true,
            isModernRemoveUnavailable: true
        });
        try {
            fixture = createFixture();
            const textArea = createTextArea();

            expect(() => textArea.focus()).not.toThrow();
            expect(fixture.getToolbar()?.dataset.tampermonkeyMarkdownEnhancerColorScheme).toBe("dark");
            expect(media.addEventListener).not.toHaveBeenCalled();
            expect(media.addListener).not.toHaveBeenCalled();
            expect(() => fixture?.dispose()).not.toThrow();
            fixture = undefined;
        } finally {
            media.restore();
        }
    });

    test("cleans partial media registrations when both listener APIs throw", () => {
        const media = createMediaPreferenceFixture(window, true, {
            isLegacyAddMutatingBeforeThrow: true,
            isLegacyAddThrowing: true,
            isModernAddMutatingBeforeThrow: true,
            isModernAddThrowing: true
        });
        try {
            fixture = createFixture();
            const textArea = createTextArea();

            expect(() => textArea.focus()).not.toThrow();
            expect(fixture.getToolbar()?.dataset.tampermonkeyMarkdownEnhancerColorScheme).toBe("dark");
            expect(media.addEventListener).toHaveBeenCalledOnce();
            expect(media.addListener).toHaveBeenCalledOnce();
            expect(media.removeEventListener).toHaveBeenCalledOnce();
            expect(media.removeEventListener.mock.calls[0]?.[1]).toBe(media.addEventListener.mock.calls[0]?.[1]);
            expect(media.removeListener).toHaveBeenCalledOnce();
            expect(media.removeListener.mock.calls[0]?.[0]).toBe(media.addListener.mock.calls[0]?.[0]);
            media.setMatches(false);
            expect(fixture.getToolbar()?.dataset.tampermonkeyMarkdownEnhancerColorScheme).toBe("dark");
            expect(() => fixture?.dispose()).not.toThrow();
            fixture = undefined;
            expect(media.removeEventListener).toHaveBeenCalledOnce();
            expect(media.removeListener).toHaveBeenCalledOnce();
        } finally {
            media.restore();
        }
    });

    test("continues to the legacy media API when partial modern cleanup throws", () => {
        const media = createMediaPreferenceFixture(window, false, {
            isModernAddMutatingBeforeThrow: true,
            isModernAddThrowing: true,
            isModernRemoveThrowing: true
        });
        try {
            fixture = createFixture();
            const textArea = createTextArea();

            expect(() => textArea.focus()).not.toThrow();
            expect(media.addEventListener).toHaveBeenCalledOnce();
            expect(media.removeEventListener).toHaveBeenCalledTimes(2);
            expect(media.addListener).toHaveBeenCalledOnce();
            media.setMatches(true);
            expect(fixture.getToolbar()?.dataset.tampermonkeyMarkdownEnhancerColorScheme).toBe("dark");
            expect(() => fixture?.dispose()).not.toThrow();
            fixture = undefined;
            expect(media.removeListener).toHaveBeenCalledOnce();
        } finally {
            media.restore();
        }
    });

    test("retries failed media listener registration on the identical query object", () => {
        let isRegistrationFailing = true;
        const media = createMediaPreferenceFixture(window, true, {
            getIsLegacyAddThrowing: () => isRegistrationFailing,
            getIsModernAddThrowing: () => isRegistrationFailing
        });
        try {
            fixture = createFixture();
            const textArea = createTextArea();
            textArea.focus();
            const toolbar = fixture.getToolbar();
            if (!toolbar) {
                throw new Error("Expected toolbar");
            }

            expect(toolbar.dataset.tampermonkeyMarkdownEnhancerColorScheme).toBe("dark");
            expect(media.matchMedia).toHaveBeenCalledOnce();
            expect(media.addEventListener).toHaveBeenCalledOnce();
            expect(media.addListener).toHaveBeenCalledOnce();
            isRegistrationFailing = false;

            textArea.dispatchEvent(new InputEvent("input", { bubbles: true }));

            expect(media.matchMedia).toHaveBeenCalledOnce();
            expect(media.addEventListener).toHaveBeenCalledTimes(2);
            expect(media.addListener).toHaveBeenCalledOnce();
            media.setMatches(false);
            expect(toolbar.dataset.tampermonkeyMarkdownEnhancerColorScheme).toBe("light");
        } finally {
            media.restore();
        }
    });

    test.each(["modern", "legacy"] as const)(
        "retries one transient %s media listener removal and clears the registration state",
        (mode) => {
            let removalAttemptCount = 0;
            const media = createMediaPreferenceFixture(
                window,
                false,
                mode === "modern"
                    ? { getIsModernRemoveThrowing: () => removalAttemptCount++ === 0 }
                    : {
                          getIsLegacyRemoveThrowing: () => removalAttemptCount++ === 0,
                          isModernAddThrowing: true
                      }
            );
            try {
                fixture = createFixture();
                const textArea = createTextArea();
                textArea.focus();
                const toolbar = fixture.getToolbar();
                if (!toolbar) {
                    throw new Error("Expected toolbar");
                }
                const registeredCallback =
                    mode === "modern"
                        ? media.addEventListener.mock.calls[0]?.[1]
                        : media.addListener.mock.calls[0]?.[0];
                const dispose = fixture.dispose;

                expect(() => dispose()).not.toThrow();
                fixture = undefined;
                expect(toolbar.isConnected).toBe(false);
                const removalCalls =
                    mode === "modern" ? media.removeEventListener.mock.calls : media.removeListener.mock.calls;
                expect(removalCalls).toHaveLength(2);
                expect(removalCalls[0]?.at(-1)).toBe(registeredCallback);
                expect(removalCalls[1]?.at(-1)).toBe(registeredCallback);
                expect(() => dispose()).not.toThrow();
                expect(removalCalls).toHaveLength(2);
                media.setMatches(true);
                expect(toolbar.dataset.tampermonkeyMarkdownEnhancerColorScheme).toBe("light");
            } finally {
                media.restore();
            }
        }
    );

    test.each(["modern", "legacy"] as const)(
        "bounds persistent %s media listener removal failures while completing disposal",
        (mode) => {
            const media = createMediaPreferenceFixture(
                window,
                false,
                mode === "modern"
                    ? { isModernRemoveThrowing: true }
                    : { isLegacyRemoveThrowing: true, isModernAddThrowing: true }
            );
            try {
                fixture = createFixture();
                const textArea = createTextArea();
                textArea.focus();
                const toolbar = fixture.getToolbar();
                if (!toolbar) {
                    throw new Error("Expected toolbar");
                }
                const dispose = fixture.dispose;

                expect(() => dispose()).not.toThrow();
                fixture = undefined;
                expect(toolbar.isConnected).toBe(false);
                const removalCalls =
                    mode === "modern" ? media.removeEventListener.mock.calls : media.removeListener.mock.calls;
                expect(removalCalls).toHaveLength(2);
                expect(() => dispose()).not.toThrow();
                expect(removalCalls).toHaveLength(2);
                media.setMatches(true);
                expect(toolbar.dataset.tampermonkeyMarkdownEnhancerColorScheme).toBe("light");
            } finally {
                media.restore();
            }
        }
    );

    test("updates exact computed schemes after ancestor class and style changes", async () => {
        const scope = document.createElement("section");
        const textArea = document.createElement("textarea");
        textArea.dataset.isSupportedEditor = "true";
        scope.append(textArea);
        document.body.append(scope);
        vi.spyOn(window, "getComputedStyle").mockImplementation(
            () =>
                ({
                    colorScheme: scope.classList.contains("dark-scope")
                        ? "dark"
                        : scope.style.colorScheme === "only light"
                          ? "only light"
                          : scope.dataset.palette === "dark"
                            ? "only dark"
                            : "normal"
                }) as CSSStyleDeclaration
        );
        fixture = createFixture();
        textArea.focus();
        const toolbar = fixture.getToolbar();
        if (!toolbar) {
            throw new Error("Expected toolbar");
        }
        expect(toolbar.dataset.tampermonkeyMarkdownEnhancerColorScheme).toBe("light");

        scope.classList.add("dark-scope");
        await flushMutationObserver();
        expect(fixture.getToolbar()).toBe(toolbar);
        expect(toolbar.dataset.tampermonkeyMarkdownEnhancerColorScheme).toBe("dark");

        scope.classList.remove("dark-scope");
        scope.style.colorScheme = "only light";
        await flushMutationObserver();
        expect(fixture.getToolbar()).toBe(toolbar);
        expect(toolbar.dataset.tampermonkeyMarkdownEnhancerColorScheme).toBe("light");

        scope.style.removeProperty("color-scheme");
        scope.dataset.palette = "dark";
        await flushMutationObserver();
        expect(fixture.getToolbar()).toBe(toolbar);
        expect(toolbar.dataset.tampermonkeyMarkdownEnhancerColorScheme).toBe("dark");
    });

    test("updates nearest ancestor and open Shadow host theme attributes in place", async () => {
        vi.spyOn(window, "getComputedStyle").mockReturnValue({ colorScheme: "normal" } as CSSStyleDeclaration);
        fixture = createFixture();
        const outer = document.createElement("main");
        outer.dataset.theme = "dark";
        const host = document.createElement("article");
        host.dataset.theme = "dark";
        host.dataset.colorMode = "light";
        const shadowRoot = host.attachShadow({ mode: "open" });
        const scope = document.createElement("section");
        scope.dataset.bsTheme = "LIGHT";
        const textArea = document.createElement("textarea");
        textArea.dataset.isSupportedEditor = "true";
        scope.append(textArea);
        shadowRoot.append(scope);
        outer.append(host);
        document.body.append(outer);
        textArea.focus();
        const toolbar = shadowRoot.querySelector<HTMLElement>(TOOLBAR_SELECTOR);
        if (!toolbar) {
            throw new Error("Expected ShadowRoot toolbar");
        }
        expect(toolbar.dataset.tampermonkeyMarkdownEnhancerColorScheme).toBe("light");

        scope.removeAttribute("data-bs-theme");
        await flushMutationObserver();
        expect(shadowRoot.querySelector(TOOLBAR_SELECTOR)).toBe(toolbar);
        expect(toolbar.dataset.tampermonkeyMarkdownEnhancerColorScheme).toBe("dark");

        host.dataset.theme = "custom";
        await flushMutationObserver();
        expect(shadowRoot.querySelector(TOOLBAR_SELECTOR)).toBe(toolbar);
        expect(toolbar.dataset.tampermonkeyMarkdownEnhancerColorScheme).toBe("light");
    });

    test("updates computed schemes for stylesheet mutations without full reconciliation", async () => {
        let computedColorScheme = "light";
        const getComputedStyle = vi
            .spyOn(window, "getComputedStyle")
            .mockImplementation(() => ({ colorScheme: computedColorScheme }) as CSSStyleDeclaration);
        fixture = createFixture();
        const textArea = createTextArea();
        textArea.focus();
        const toolbar = fixture.getToolbar();
        if (!toolbar) {
            throw new Error("Expected toolbar");
        }
        textArea.blur();
        await flushMutationObserver();
        const resolverCallCount = fixture.getResolverCallCount();
        const expectSchemeAfterMutation = async (
            nextScheme: "light" | "dark",
            mutateStyleSheet: () => void
        ): Promise<void> => {
            computedColorScheme = nextScheme;
            mutateStyleSheet();
            await flushMutationObserver();
            expect(fixture?.getToolbar()).toBe(toolbar);
            expect(toolbar.dataset.tampermonkeyMarkdownEnhancerColorScheme).toBe(nextScheme);
            expect(fixture?.getResolverCallCount()).toBe(resolverCallCount);
        };

        const style = document.createElement("style");
        style.textContent = ":root { color-scheme: dark; }";
        await expectSchemeAfterMutation("dark", () => document.head.append(style));
        await expectSchemeAfterMutation("light", () => {
            const textNode = style.firstChild;
            if (!textNode) {
                throw new Error("Expected style text node");
            }
            textNode.nodeValue = ":root { color-scheme: light; }";
        });
        await expectSchemeAfterMutation("dark", () => {
            style.textContent = ":root { color-scheme: dark; }";
        });
        await expectSchemeAfterMutation("light", () => style.setAttribute("media", "screen"));
        await expectSchemeAfterMutation("dark", () => style.setAttribute("disabled", ""));
        await expectSchemeAfterMutation("light", () => style.remove());

        const refreshCallCountBeforePreload = getComputedStyle.mock.calls.length;
        const preload = document.createElement("link");
        preload.rel = "preload";
        preload.href = "/theme.css";
        computedColorScheme = "dark";
        document.head.append(preload);
        await flushMutationObserver();
        preload.href = "/other.css";
        await flushMutationObserver();
        preload.media = "screen";
        await flushMutationObserver();
        preload.toggleAttribute("disabled", true);
        await flushMutationObserver();
        preload.remove();
        await flushMutationObserver();
        expect(getComputedStyle.mock.calls).toHaveLength(refreshCallCountBeforePreload);
        expect(toolbar.dataset.tampermonkeyMarkdownEnhancerColorScheme).toBe("light");

        const preloadWrapper = document.createElement("div");
        const nestedPreload = document.createElement("link");
        nestedPreload.rel = "preload";
        preloadWrapper.append(nestedPreload);
        document.head.append(preloadWrapper);
        await flushMutationObserver();
        preloadWrapper.remove();
        await flushMutationObserver();
        expect(getComputedStyle.mock.calls).toHaveLength(refreshCallCountBeforePreload);

        const link = document.createElement("link");
        link.rel = "preload";
        link.href = "/theme.css";
        document.head.append(link);
        await flushMutationObserver();
        await expectSchemeAfterMutation("dark", () => link.setAttribute("rel", "stylesheet"));
        await expectSchemeAfterMutation("light", () => link.setAttribute("href", "/light.css"));
        await expectSchemeAfterMutation("dark", () => link.setAttribute("media", "screen"));
        await expectSchemeAfterMutation("light", () => link.setAttribute("disabled", ""));
        await expectSchemeAfterMutation("dark", () => link.setAttribute("rel", "preload"));
        const refreshCallCountAfterRelRemoval = getComputedStyle.mock.calls.length;
        computedColorScheme = "light";
        link.remove();
        await flushMutationObserver();
        expect(getComputedStyle.mock.calls).toHaveLength(refreshCallCountAfterRelRemoval);
        expect(toolbar.dataset.tampermonkeyMarkdownEnhancerColorScheme).toBe("dark");

        const removedStyleSheet = document.createElement("link");
        removedStyleSheet.rel = "alternate stylesheet";
        document.head.append(removedStyleSheet);
        await flushMutationObserver();
        await expectSchemeAfterMutation("light", () => removedStyleSheet.remove());

        const refreshCallCount = getComputedStyle.mock.calls.length;
        style.title = "unrelated";
        document.body.append(document.createElement("span"));
        await flushMutationObserver();
        expect(getComputedStyle.mock.calls).toHaveLength(refreshCallCount);
        expect(fixture.getResolverCallCount()).toBe(resolverCallCount);
    });

    test("refreshes computed scheme on captured stylesheet link loads without editor reconciliation", async () => {
        let computedColorScheme = "light";
        vi.spyOn(window, "getComputedStyle").mockImplementation(
            () => ({ colorScheme: computedColorScheme }) as CSSStyleDeclaration
        );
        fixture = createFixture();
        const textArea = createTextArea();
        textArea.focus();
        const toolbar = fixture.getToolbar();
        if (!toolbar) {
            throw new Error("Expected toolbar");
        }
        await flushMutationObserver();
        const link = document.createElement("link");
        link.rel = "stylesheet";
        document.head.append(link);
        await flushMutationObserver();
        const resolverCallCountAfterInsertion = fixture.getResolverCallCount();

        computedColorScheme = "dark";
        link.dispatchEvent(new Event("load"));

        expect(toolbar.dataset.tampermonkeyMarkdownEnhancerColorScheme).toBe("dark");
        expect(fixture.getResolverCallCount()).toBe(resolverCallCountAfterInsertion);

        const preload = document.createElement("link");
        preload.rel = "preload";
        document.head.append(preload);
        await flushMutationObserver();
        const resolverCallCountBeforePreload = fixture.getResolverCallCount();
        computedColorScheme = "light";
        preload.dispatchEvent(new Event("load"));
        expect(toolbar.dataset.tampermonkeyMarkdownEnhancerColorScheme).toBe("dark");
        expect(fixture.getResolverCallCount()).toBe(resolverCallCountBeforePreload);
    });

    test("captures stylesheet link loads from an active open shadow root", () => {
        let computedColorScheme = "light";
        vi.spyOn(window, "getComputedStyle").mockImplementation(
            () => ({ colorScheme: computedColorScheme }) as CSSStyleDeclaration
        );
        fixture = createFixture();
        const host = document.createElement("section");
        const shadowRoot = host.attachShadow({ mode: "open" });
        const addRootListener = vi.spyOn(shadowRoot, "addEventListener");
        const removeRootListener = vi.spyOn(shadowRoot, "removeEventListener");
        const textArea = document.createElement("textarea");
        textArea.dataset.isSupportedEditor = "true";
        shadowRoot.append(textArea);
        document.body.append(host);
        textArea.focus();
        const toolbar = shadowRoot.querySelector<HTMLElement>(TOOLBAR_SELECTOR);
        if (!toolbar) {
            throw new Error("Expected toolbar");
        }
        const loadListenerCalls = getStyleSheetLoadListenerCalls(addRootListener.mock.calls);
        expect(loadListenerCalls).toHaveLength(1);

        const link = document.createElement("link");
        link.rel = "alternate STYLESHEET";
        shadowRoot.append(link);
        computedColorScheme = "dark";
        link.dispatchEvent(new Event("load"));

        expect(toolbar.dataset.tampermonkeyMarkdownEnhancerColorScheme).toBe("dark");
        fixture.dispose();
        fixture = undefined;
        const removeLoadCalls = getStyleSheetLoadListenerCalls(removeRootListener.mock.calls);
        expect(removeLoadCalls).toHaveLength(1);
        expect(removeLoadCalls[0]?.[1]).toBe(loadListenerCalls[0]?.[1]);
    });

    test("removes exact stylesheet load listeners on inactivity, relocation, and disposal", async () => {
        const addInitialListener = vi.spyOn(document, "addEventListener");
        const removeInitialListener = vi.spyOn(document, "removeEventListener");
        fixture = createFixture();
        const textArea = createTextArea();
        textArea.focus();
        const toolbar = fixture.getToolbar();
        if (!toolbar) {
            throw new Error("Expected toolbar");
        }
        const initialAddCalls = getStyleSheetLoadListenerCalls(addInitialListener.mock.calls);
        expect(initialAddCalls).toHaveLength(1);
        const initialCallback = initialAddCalls[0]?.[1];

        fixture.setEnabled(false);
        const inactiveRemoveCalls = getStyleSheetLoadListenerCalls(removeInitialListener.mock.calls);
        expect(inactiveRemoveCalls).toHaveLength(1);
        expect(inactiveRemoveCalls[0]?.[1]).toBe(initialCallback);

        fixture.setEnabled(true);
        textArea.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
        const reactivatedAddCalls = getStyleSheetLoadListenerCalls(addInitialListener.mock.calls);
        expect(reactivatedAddCalls).toHaveLength(2);
        expect(reactivatedAddCalls[1]?.[1]).toBe(initialCallback);

        const frame = document.createElement("iframe");
        document.body.append(frame);
        const destinationDocument = frame.contentDocument;
        if (!destinationDocument) {
            throw new Error("Expected destination document");
        }
        const addDestinationListener = vi.spyOn(destinationDocument, "addEventListener");
        const removeDestinationListener = vi.spyOn(destinationDocument, "removeEventListener");
        destinationDocument.body.append(textArea, toolbar);
        await flushMutationObserver();

        const relocatedRemoveCalls = getStyleSheetLoadListenerCalls(removeInitialListener.mock.calls);
        const destinationAddCalls = getStyleSheetLoadListenerCalls(addDestinationListener.mock.calls);
        expect(relocatedRemoveCalls).toHaveLength(2);
        expect(relocatedRemoveCalls[1]?.[1]).toBe(initialCallback);
        expect(destinationAddCalls).toHaveLength(1);
        expect(destinationAddCalls[0]?.[1]).toBe(initialCallback);

        fixture.dispose();
        fixture = undefined;
        const destinationRemoveCalls = getStyleSheetLoadListenerCalls(removeDestinationListener.mock.calls);
        expect(destinationRemoveCalls).toHaveLength(1);
        expect(destinationRemoveCalls[0]?.[1]).toBe(initialCallback);
        expect(toolbar.isConnected).toBe(false);
    });

    test("places and synchronizes the toolbar in the textarea named slot", async () => {
        vi.spyOn(window, "getComputedStyle").mockReturnValue({ colorScheme: "normal" } as CSSStyleDeclaration);
        fixture = createFixture();
        const host = document.createElement("section");
        const shadowRoot = host.attachShadow({ mode: "open" });
        const darkSlot = document.createElement("slot");
        darkSlot.name = "editor";
        darkSlot.dataset.theme = "dark";
        const lightSlot = document.createElement("slot");
        lightSlot.name = "other";
        lightSlot.dataset.theme = "light";
        shadowRoot.append(darkSlot, lightSlot);
        const textArea = document.createElement("textarea");
        textArea.dataset.isSupportedEditor = "true";
        textArea.slot = "editor";
        host.append(textArea);
        document.body.append(host);

        textArea.focus();
        const toolbar = fixture.getToolbar();
        if (!toolbar) {
            throw new Error("Expected toolbar");
        }
        expect(textArea.assignedSlot).toBe(darkSlot);
        expect(toolbar.slot).toBe("editor");
        expect(toolbar.assignedSlot).toBe(textArea.assignedSlot);
        expect(toolbar.dataset.tampermonkeyMarkdownEnhancerColorScheme).toBe("dark");

        textArea.slot = "other";
        await flushMutationObserver();

        expect(textArea.assignedSlot).toBe(lightSlot);
        expect(toolbar.slot).toBe("other");
        expect(toolbar.assignedSlot).toBe(textArea.assignedSlot);
        expect(toolbar.dataset.tampermonkeyMarkdownEnhancerColorScheme).toBe("light");
    });

    test("refreshes scheme signals for slot attributes when composed scope identities stay unchanged", async () => {
        const host = document.createElement("section");
        const shadowRoot = host.attachShadow({ mode: "open" });
        const slot = document.createElement("slot");
        const wrapper = document.createElement("div");
        const textArea = document.createElement("textarea");
        textArea.dataset.isSupportedEditor = "true";
        wrapper.append(textArea);
        host.append(wrapper);
        shadowRoot.append(slot);
        document.body.append(host);
        vi.spyOn(window, "getComputedStyle").mockImplementation(
            () =>
                ({
                    colorScheme: textArea.hasAttribute("slot") || wrapper.hasAttribute("slot") ? "dark" : "light"
                }) as CSSStyleDeclaration
        );
        fixture = createFixture();
        textArea.focus();
        const toolbar = fixture.getToolbar();
        if (!toolbar) {
            throw new Error("Expected toolbar");
        }
        const initialSignalElements = collectColorSchemeSignalElements(textArea);
        expect(wrapper.assignedSlot).toBe(slot);
        expect(toolbar.dataset.tampermonkeyMarkdownEnhancerColorScheme).toBe("light");

        textArea.setAttribute("slot", "nested-editor");
        await flushMutationObserver();
        expect(collectColorSchemeSignalElements(textArea)).toEqual(initialSignalElements);
        expect(wrapper.assignedSlot).toBe(slot);
        expect(toolbar.slot).toBe("nested-editor");
        expect(toolbar.dataset.tampermonkeyMarkdownEnhancerColorScheme).toBe("dark");

        textArea.removeAttribute("slot");
        await flushMutationObserver();
        expect(toolbar.dataset.tampermonkeyMarkdownEnhancerColorScheme).toBe("light");

        wrapper.setAttribute("slot", "");
        await flushMutationObserver();
        expect(collectColorSchemeSignalElements(textArea)).toEqual(initialSignalElements);
        expect(wrapper.assignedSlot).toBe(slot);
        expect(toolbar.dataset.tampermonkeyMarkdownEnhancerColorScheme).toBe("dark");
    });

    test("updates assigned-slot theme scope without remounting or disturbing focus and selection", async () => {
        vi.spyOn(window, "getComputedStyle").mockReturnValue({ colorScheme: "normal" } as CSSStyleDeclaration);
        const observeMutation = vi.spyOn(MutationObserver.prototype, "observe");
        fixture = createFixture();
        const host = document.createElement("section");
        const shadowRoot = host.attachShadow({ mode: "open" });
        const darkSlot = document.createElement("slot");
        darkSlot.name = "editor";
        darkSlot.dataset.theme = "dark";
        const lightSlot = document.createElement("slot");
        lightSlot.name = "other";
        lightSlot.dataset.theme = "light";
        shadowRoot.append(darkSlot, lightSlot);
        const textArea = document.createElement("textarea");
        textArea.dataset.isSupportedEditor = "true";
        textArea.slot = "editor";
        textArea.value = "# Heading";
        textArea.setSelectionRange(0, textArea.value.length, "backward");
        host.append(textArea);
        document.body.append(host);
        textArea.focus();
        const toolbar = fixture.getToolbar();
        if (!toolbar) {
            throw new Error("Expected toolbar");
        }
        expect(toolbar.dataset.tampermonkeyMarkdownEnhancerColorScheme).toBe("dark");
        expect(
            observeMutation.mock.calls.some(
                ([target, options]) =>
                    target === textArea && (options as MutationObserverInit).attributeFilter?.join(",") === "slot"
            )
        ).toBe(true);
        expect(
            observeMutation.mock.calls.some(
                ([target, options]) =>
                    target === shadowRoot &&
                    (options as MutationObserverInit).subtree === true &&
                    (options as MutationObserverInit).attributeFilter?.join(",") === "name"
            )
        ).toBe(true);

        const panel = openStylePanel(toolbar);
        const focusedRow = panel.querySelector<HTMLButtonElement>('button[data-block-style="heading2"]');
        if (!focusedRow) {
            throw new Error("Expected style row");
        }
        focusedRow.focus();
        const selection = [textArea.selectionStart, textArea.selectionEnd, textArea.selectionDirection];

        textArea.slot = "other";
        await flushMutationObserver();
        expect(fixture.getToolbar()).toBe(toolbar);
        expect(getStylePanel(toolbar)).toBe(panel);
        expect(document.activeElement).toBe(focusedRow);
        expect([textArea.selectionStart, textArea.selectionEnd, textArea.selectionDirection]).toEqual(selection);
        expect(toolbar.dataset.tampermonkeyMarkdownEnhancerColorScheme).toBe("light");

        darkSlot.name = "other";
        lightSlot.name = "editor";
        await flushMutationObserver();
        expect(fixture.getToolbar()).toBe(toolbar);
        expect(document.activeElement).toBe(focusedRow);
        expect(toolbar.dataset.tampermonkeyMarkdownEnhancerColorScheme).toBe("dark");
    });

    test("updates an assigned ancestor slot scope without replacing toolbar state", async () => {
        vi.spyOn(window, "getComputedStyle").mockReturnValue({ colorScheme: "normal" } as CSSStyleDeclaration);
        const observeMutation = vi.spyOn(MutationObserver.prototype, "observe");
        fixture = createFixture();
        const host = document.createElement("section");
        const shadowRoot = host.attachShadow({ mode: "open" });
        const darkSlot = document.createElement("slot");
        darkSlot.name = "dark";
        darkSlot.dataset.theme = "dark";
        const lightSlot = document.createElement("slot");
        lightSlot.name = "light";
        lightSlot.dataset.theme = "light";
        shadowRoot.append(darkSlot, lightSlot);
        const wrapper = document.createElement("div");
        wrapper.slot = "dark";
        const textArea = document.createElement("textarea");
        textArea.dataset.isSupportedEditor = "true";
        textArea.value = "# Heading";
        textArea.setSelectionRange(0, textArea.value.length, "backward");
        wrapper.append(textArea);
        host.append(wrapper);
        document.body.append(host);
        textArea.focus();
        const toolbar = fixture.getToolbar();
        if (!toolbar) {
            throw new Error("Expected toolbar");
        }
        expect(wrapper.assignedSlot).toBe(darkSlot);
        expect(toolbar.dataset.tampermonkeyMarkdownEnhancerColorScheme).toBe("dark");
        expect(
            observeMutation.mock.calls.some(
                ([target, options]) =>
                    target === wrapper && (options as MutationObserverInit).attributeFilter?.join(",") === "slot"
            )
        ).toBe(true);

        const panel = openStylePanel(toolbar);
        const focusedRow = panel.querySelector<HTMLButtonElement>('button[data-block-style="heading2"]');
        if (!focusedRow) {
            throw new Error("Expected style row");
        }
        focusedRow.focus();
        const selection = [textArea.selectionStart, textArea.selectionEnd, textArea.selectionDirection];

        wrapper.slot = "light";
        await flushMutationObserver();

        expect(wrapper.assignedSlot).toBe(lightSlot);
        expect(fixture.getToolbar()).toBe(toolbar);
        expect(getStylePanel(toolbar)).toBe(panel);
        expect(document.activeElement).toBe(focusedRow);
        expect([textArea.selectionStart, textArea.selectionEnd, textArea.selectionDirection]).toEqual(selection);
        expect(toolbar.dataset.tampermonkeyMarkdownEnhancerColorScheme).toBe("light");
    });

    test("rebinds theme scope when a slot is inserted into an existing relevant host", async () => {
        vi.spyOn(window, "getComputedStyle").mockReturnValue({ colorScheme: "normal" } as CSSStyleDeclaration);
        const observeMutation = vi.spyOn(MutationObserver.prototype, "observe");
        const disconnectMutation = vi.spyOn(MutationObserver.prototype, "disconnect");
        fixture = createFixture();
        const host = document.createElement("section");
        host.dataset.theme = "dark";
        const shadowRoot = host.attachShadow({ mode: "open" });
        const wrapper = document.createElement("div");
        wrapper.slot = "editor";
        const textArea = document.createElement("textarea");
        textArea.dataset.isSupportedEditor = "true";
        wrapper.append(textArea);
        host.append(wrapper);
        document.body.append(host);
        textArea.focus();
        const toolbar = fixture.getToolbar();
        if (!toolbar) {
            throw new Error("Expected toolbar");
        }
        expect(wrapper.assignedSlot).toBeNull();
        expect(toolbar.dataset.tampermonkeyMarkdownEnhancerColorScheme).toBe("dark");
        expect(
            observeMutation.mock.calls.some(
                ([target, options]) =>
                    target === shadowRoot &&
                    (options as MutationObserverInit).childList === true &&
                    (options as MutationObserverInit).subtree === true &&
                    (options as MutationObserverInit).attributeFilter?.join(",") === "name"
            )
        ).toBe(true);
        await flushMutationObserver();
        const observeCallCount = observeMutation.mock.calls.length;
        const disconnectCallCount = disconnectMutation.mock.calls.length;

        shadowRoot.append(document.createElement("span"));
        await flushMutationObserver();

        expect(observeMutation.mock.calls).toHaveLength(observeCallCount);
        expect(disconnectMutation.mock.calls).toHaveLength(disconnectCallCount);

        const lightSlot = document.createElement("slot");
        lightSlot.name = "editor";
        lightSlot.dataset.theme = "light";
        shadowRoot.append(lightSlot);
        await flushMutationObserver();

        expect(wrapper.assignedSlot).toBe(lightSlot);
        expect(fixture.getToolbar()).toBe(toolbar);
        expect(toolbar.dataset.tampermonkeyMarkdownEnhancerColorScheme).toBe("light");

        lightSlot.remove();
        await flushMutationObserver();

        expect(wrapper.assignedSlot).toBeNull();
        expect(fixture.getToolbar()).toBe(toolbar);
        expect(toolbar.dataset.tampermonkeyMarkdownEnhancerColorScheme).toBe("dark");
    });

    test("refreshes slotchange theme state without remounting or disturbing menu, focus, and selection", async () => {
        let computedColorScheme = "light";
        const getComputedStyle = vi
            .spyOn(window, "getComputedStyle")
            .mockImplementation(() => ({ colorScheme: computedColorScheme }) as CSSStyleDeclaration);
        fixture = createFixture();
        const host = document.createElement("section");
        const shadowRoot = host.attachShadow({ mode: "open" });
        const slot = document.createElement("slot");
        const wrapper = document.createElement("div");
        const textArea = document.createElement("textarea");
        textArea.dataset.isSupportedEditor = "true";
        textArea.value = "# Heading";
        textArea.setSelectionRange(0, textArea.value.length, "backward");
        wrapper.append(textArea);
        host.append(wrapper);
        shadowRoot.append(slot);
        document.body.append(host);
        textArea.focus();
        const toolbar = fixture.getToolbar();
        if (!toolbar) {
            throw new Error("Expected toolbar");
        }
        await flushMutationObserver();
        const panel = openStylePanel(toolbar);
        const focusedRow = panel.querySelector<HTMLButtonElement>('button[data-block-style="heading2"]');
        if (!focusedRow) {
            throw new Error("Expected style row");
        }
        focusedRow.focus();
        const selection = [textArea.selectionStart, textArea.selectionEnd, textArea.selectionDirection];
        const resolverCallCount = fixture.getResolverCallCount();
        const computedStyleCallCount = getComputedStyle.mock.calls.length;

        computedColorScheme = "dark";
        slot.dispatchEvent(new Event("slotchange", { bubbles: true }));

        expect(fixture.getToolbar()).toBe(toolbar);
        expect(getStylePanel(toolbar)).toBe(panel);
        expect(panel.hidden).toBe(false);
        expect(document.activeElement).toBe(focusedRow);
        expect([textArea.selectionStart, textArea.selectionEnd, textArea.selectionDirection]).toEqual(selection);
        expect(toolbar.dataset.tampermonkeyMarkdownEnhancerColorScheme).toBe("dark");
        expect(fixture.getResolverCallCount()).toBe(resolverCallCount);
        expect(getComputedStyle.mock.calls).toHaveLength(computedStyleCallCount + 1);
    });

    test("rebinds exact slotchange listeners for relevant existing slots and releases them through lifecycle changes", async () => {
        fixture = createFixture();
        const host = document.createElement("section");
        const shadowRoot = host.attachShadow({ mode: "open" });
        const rootAddListener = vi.spyOn(shadowRoot, "addEventListener");
        const rootRemoveListener = vi.spyOn(shadowRoot, "removeEventListener");
        const firstSlot = document.createElement("slot");
        const secondSlot = document.createElement("slot");
        secondSlot.name = "other";
        const firstSlotAddListener = vi.spyOn(firstSlot, "addEventListener");
        const firstSlotRemoveListener = vi.spyOn(firstSlot, "removeEventListener");
        const secondSlotAddListener = vi.spyOn(secondSlot, "addEventListener");
        const secondSlotRemoveListener = vi.spyOn(secondSlot, "removeEventListener");
        shadowRoot.append(firstSlot, secondSlot);
        const textArea = document.createElement("textarea");
        textArea.dataset.isSupportedEditor = "true";
        host.append(textArea);
        document.body.append(host);

        textArea.focus();
        const rootAdds = getSlotChangeListenerCalls(rootAddListener.mock.calls);
        const firstSlotAdds = getSlotChangeListenerCalls(firstSlotAddListener.mock.calls);
        const secondSlotAdds = getSlotChangeListenerCalls(secondSlotAddListener.mock.calls);
        expect(rootAdds).toHaveLength(1);
        expect(firstSlotAdds).toHaveLength(1);
        expect(secondSlotAdds).toHaveLength(1);
        const callback = rootAdds[0]?.[1];
        expect(firstSlotAdds[0]?.[1]).toBe(callback);
        expect(secondSlotAdds[0]?.[1]).toBe(callback);

        const insertedSlot = document.createElement("slot");
        insertedSlot.name = "inserted";
        const insertedSlotAddListener = vi.spyOn(insertedSlot, "addEventListener");
        const insertedSlotRemoveListener = vi.spyOn(insertedSlot, "removeEventListener");
        shadowRoot.append(insertedSlot);
        await flushMutationObserver();
        expect(getSlotChangeListenerCalls(insertedSlotAddListener.mock.calls)).toEqual([["slotchange", callback]]);
        expect(getSlotChangeListenerCalls(rootAddListener.mock.calls)).toHaveLength(1);
        expect(getSlotChangeListenerCalls(firstSlotAddListener.mock.calls)).toHaveLength(1);

        insertedSlot.remove();
        await flushMutationObserver();
        expect(getSlotChangeListenerCalls(insertedSlotRemoveListener.mock.calls)).toEqual([["slotchange", callback]]);

        fixture.setEnabled(false);
        expect(getSlotChangeListenerCalls(rootRemoveListener.mock.calls)).toEqual([["slotchange", callback]]);
        expect(getSlotChangeListenerCalls(firstSlotRemoveListener.mock.calls)).toEqual([["slotchange", callback]]);
        expect(getSlotChangeListenerCalls(secondSlotRemoveListener.mock.calls)).toEqual([["slotchange", callback]]);

        fixture.setEnabled(true);
        textArea.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
        expect(getSlotChangeListenerCalls(rootAddListener.mock.calls)).toHaveLength(2);
        expect(getSlotChangeListenerCalls(firstSlotAddListener.mock.calls)).toHaveLength(2);
        expect(getSlotChangeListenerCalls(secondSlotAddListener.mock.calls)).toHaveLength(2);

        fixture.dispose();
        fixture = undefined;
        expect(getSlotChangeListenerCalls(rootRemoveListener.mock.calls)).toHaveLength(2);
        expect(getSlotChangeListenerCalls(firstSlotRemoveListener.mock.calls)).toHaveLength(2);
        expect(getSlotChangeListenerCalls(secondSlotRemoveListener.mock.calls)).toHaveLength(2);
    });

    test("rebinds exact slotchange listeners when the active editor moves between relevant hosts", async () => {
        fixture = createFixture();
        const sourceHost = document.createElement("section");
        const sourceRoot = sourceHost.attachShadow({ mode: "open" });
        const sourceSlot = document.createElement("slot");
        sourceRoot.append(sourceSlot);
        const destinationHost = document.createElement("section");
        const destinationRoot = destinationHost.attachShadow({ mode: "open" });
        const destinationSlot = document.createElement("slot");
        destinationRoot.append(destinationSlot);
        const sourceRootAddListener = vi.spyOn(sourceRoot, "addEventListener");
        const sourceRootRemoveListener = vi.spyOn(sourceRoot, "removeEventListener");
        const sourceSlotAddListener = vi.spyOn(sourceSlot, "addEventListener");
        const sourceSlotRemoveListener = vi.spyOn(sourceSlot, "removeEventListener");
        const destinationRootAddListener = vi.spyOn(destinationRoot, "addEventListener");
        const destinationRootRemoveListener = vi.spyOn(destinationRoot, "removeEventListener");
        const destinationSlotAddListener = vi.spyOn(destinationSlot, "addEventListener");
        const destinationSlotRemoveListener = vi.spyOn(destinationSlot, "removeEventListener");
        const textArea = document.createElement("textarea");
        textArea.dataset.isSupportedEditor = "true";
        sourceHost.append(textArea);
        document.body.append(sourceHost, destinationHost);

        textArea.focus();
        const toolbar = fixture.getToolbar();
        if (!toolbar) {
            throw new Error("Expected toolbar");
        }
        const callback = getSlotChangeListenerCalls(sourceRootAddListener.mock.calls)[0]?.[1];
        expect(getSlotChangeListenerCalls(sourceRootAddListener.mock.calls)).toEqual([["slotchange", callback]]);
        expect(getSlotChangeListenerCalls(sourceSlotAddListener.mock.calls)).toEqual([["slotchange", callback]]);

        destinationHost.append(textArea, toolbar);
        await flushMutationObserver();

        expect(fixture.getToolbar()).toBe(toolbar);
        expect(getSlotChangeListenerCalls(sourceRootRemoveListener.mock.calls)).toEqual([["slotchange", callback]]);
        expect(getSlotChangeListenerCalls(sourceSlotRemoveListener.mock.calls)).toEqual([["slotchange", callback]]);
        expect(getSlotChangeListenerCalls(destinationRootAddListener.mock.calls)).toEqual([["slotchange", callback]]);
        expect(getSlotChangeListenerCalls(destinationSlotAddListener.mock.calls)).toEqual([["slotchange", callback]]);

        fixture.dispose();
        fixture = undefined;
        expect(getSlotChangeListenerCalls(destinationRootRemoveListener.mock.calls)).toEqual([
            ["slotchange", callback]
        ]);
        expect(getSlotChangeListenerCalls(destinationSlotRemoveListener.mock.calls)).toEqual([
            ["slotchange", callback]
        ]);
    });

    test("tracks manual slot assignment changes when the platform supports slot assign", async () => {
        const host = document.createElement("section");
        const shadowRoot = host.attachShadow({ mode: "open", slotAssignment: "manual" });
        const darkSlot = document.createElement("slot");
        darkSlot.dataset.theme = "dark";
        const lightSlot = document.createElement("slot");
        lightSlot.dataset.theme = "light";
        shadowRoot.append(darkSlot, lightSlot);
        const wrapper = document.createElement("div");
        const textArea = document.createElement("textarea");
        textArea.dataset.isSupportedEditor = "true";
        wrapper.append(textArea);
        host.append(wrapper);
        document.body.append(host);
        if (typeof darkSlot.assign !== "function" || typeof lightSlot.assign !== "function") {
            return;
        }
        vi.spyOn(window, "getComputedStyle").mockReturnValue({ colorScheme: "normal" } as CSSStyleDeclaration);
        darkSlot.assign(wrapper);
        await flushMutationObserver();
        fixture = createFixture();
        textArea.focus();
        const toolbar = fixture.getToolbar();
        if (!toolbar) {
            throw new Error("Expected toolbar");
        }
        expect(toolbar.dataset.tampermonkeyMarkdownEnhancerColorScheme).toBe("dark");

        lightSlot.assign(wrapper);
        await flushMutationObserver();

        expect(fixture.getToolbar()).toBe(toolbar);
        expect(toolbar.dataset.tampermonkeyMarkdownEnhancerColorScheme).toBe("light");
    });

    test("rebinds media state across owner windows and settings-driven rerenders without duplicates", async () => {
        const sourceMedia = createMediaPreferenceFixture(window, false);
        const frame = document.createElement("iframe");
        document.body.append(frame);
        const destinationWindow = frame.contentWindow;
        const destinationDocument = frame.contentDocument;
        if (!destinationWindow || !destinationDocument) {
            throw new Error("Expected destination browsing context");
        }
        const destinationMedia = createMediaPreferenceFixture(destinationWindow, true);
        try {
            fixture = createFixture();
            const textArea = createTextArea();
            textArea.focus();
            const toolbar = fixture.getToolbar();
            if (!toolbar) {
                throw new Error("Expected toolbar");
            }
            textArea.dispatchEvent(new InputEvent("input", { bubbles: true }));
            expect(sourceMedia.addEventListener).toHaveBeenCalledOnce();

            destinationDocument.body.append(textArea, toolbar);
            await flushMutationObserver();

            expect(toolbar.ownerDocument).toBe(destinationDocument);
            expect(toolbar.dataset.tampermonkeyMarkdownEnhancerColorScheme).toBe("dark");
            expect(sourceMedia.removeEventListener).toHaveBeenCalledOnce();
            expect(destinationMedia.addEventListener).toHaveBeenCalledOnce();

            destinationMedia.setMatches(false);
            expect(toolbar.dataset.tampermonkeyMarkdownEnhancerColorScheme).toBe("light");

            fixture.setRegistry(
                createCommandRegistry([
                    {
                        id: "custom.action",
                        label: "Custom action",
                        isAvailable: () => true,
                        execute: () => true
                    }
                ])
            );
            expect(toolbar.ownerDocument).toBe(destinationDocument);
            expect(toolbar.dataset.tampermonkeyMarkdownEnhancerColorScheme).toBe("light");
            expect(destinationMedia.addEventListener).toHaveBeenCalledOnce();
            expect(getCommandButton(toolbar, "custom.action").ownerDocument).toBe(destinationDocument);

            fixture.setEnabled(false);
            expect(toolbar.isConnected).toBe(false);
            expect(destinationMedia.removeEventListener).toHaveBeenCalledOnce();

            fixture.setEnabled(true);
            textArea.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
            expect(textArea.nextSibling).toBe(toolbar);
            expect(destinationMedia.addEventListener).toHaveBeenCalledTimes(2);

            fixture.dispose();
            fixture = undefined;
            expect(destinationMedia.removeEventListener).toHaveBeenCalledTimes(2);
        } finally {
            sourceMedia.restore();
            destinationMedia.restore();
        }
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

    test("ignores unrelated child insertion outside the active editor and toolbar scope", async () => {
        fixture = createFixture();
        const textArea = createTextArea();
        textArea.focus();
        const toolbar = fixture.getToolbar();
        if (!toolbar) {
            throw new Error("Expected toolbar");
        }
        textArea.blur();
        await flushMutationObserver();
        const resolverCallCount = fixture.getResolverCallCount();
        const unrelatedSection = document.createElement("section");
        document.body.append(unrelatedSection);
        await flushMutationObserver();
        unrelatedSection.append(document.createElement("span"));
        await flushMutationObserver();

        expect(fixture.getToolbar()).toBe(toolbar);
        expect(fixture.getResolverCallCount()).toBe(resolverCallCount);
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

    test("refreshes only for supported theme attributes on the current composed scope", async () => {
        const getComputedStyle = vi
            .spyOn(window, "getComputedStyle")
            .mockReturnValue({ colorScheme: "normal" } as CSSStyleDeclaration);
        const scope = document.createElement("section");
        const textArea = document.createElement("textarea");
        textArea.dataset.toolbarPlacement = "after-editor";
        textArea.dataset.isSupportedEditor = "true";
        scope.append(textArea);
        document.body.append(scope);
        fixture = createFixture();
        textArea.focus();
        expect(fixture.getToolbar()).not.toBeNull();
        textArea.blur();
        await flushMutationObserver();
        const getRefreshCount = (): number =>
            getComputedStyle.mock.calls.filter(([element]) => element === textArea).length;
        const initialRefreshCount = getRefreshCount();

        scope.dataset.custom = "dark";
        await flushMutationObserver();
        scope.title = "dark";
        await flushMutationObserver();
        textArea.dataset.custom = "dark";
        await flushMutationObserver();
        textArea.title = "dark";
        await flushMutationObserver();
        expect(getRefreshCount()).toBe(initialRefreshCount);

        for (const [attributeName, attributeValue] of [
            ["class", "theme-signal"],
            ["style", "color-scheme: normal"],
            ["data-theme", "custom"],
            ["data-color-mode", "custom"],
            ["data-bs-theme", "custom"]
        ] as const) {
            const refreshCount = getRefreshCount();
            textArea.setAttribute(attributeName, attributeValue);
            await flushMutationObserver();
            expect(getRefreshCount()).toBe(refreshCount + 1);
        }
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
                ([target, options]) =>
                    target === document.documentElement &&
                    (options as MutationObserverInit).subtree === true &&
                    (options as MutationObserverInit).attributeFilter?.join(",") === "id"
            )
        ).toBe(true);
        const broadlyObservedTargets = observeMutation.mock.calls
            .filter(
                ([, options]) =>
                    (options as MutationObserverInit).attributes === true &&
                    (options as MutationObserverInit).attributeFilter === undefined &&
                    (options as MutationObserverInit).subtree !== true
            )
            .map(([target]) => target);
        expect(new Set(broadlyObservedTargets)).toEqual(new Set([textArea]));
        expect(broadlyObservedTargets).not.toContain(toolbar);
        const colorSchemeObservedTargets = observeMutation.mock.calls
            .filter(
                ([, options]) =>
                    (options as MutationObserverInit).attributes === true &&
                    (options as MutationObserverInit).attributeFilter?.join(",") ===
                        "class,style,data-theme,data-color-mode,data-bs-theme"
            )
            .map(([target]) => target);
        expect(new Set(colorSchemeObservedTargets)).toEqual(
            new Set([textArea, document.body, document.documentElement])
        );
        expect(colorSchemeObservedTargets).not.toContain(toolbar);

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
        expect(disconnectMutation.mock.calls).toHaveLength(disconnectCountBeforeDisable + 4);

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
        if (!style?.textContent) {
            throw new Error("Expected toolbar styles");
        }
        const css = style.textContent;
        const requiredTokens = [
            "--tme-toolbar-surface",
            "--tme-toolbar-border",
            "--tme-toolbar-button-surface",
            "--tme-toolbar-button-border",
            "--tme-toolbar-button-text",
            "--tme-toolbar-button-icon",
            "--tme-toolbar-button-hover-surface",
            "--tme-toolbar-focus-ring",
            "--tme-toolbar-disabled-text",
            "--tme-toolbar-menu-surface",
            "--tme-toolbar-menu-border",
            "--tme-toolbar-menu-shadow",
            "--tme-toolbar-menu-active-surface",
            "--tme-toolbar-menu-active-border",
            "--tme-toolbar-menu-active-text",
            "--tme-toolbar-separator"
        ];
        for (const token of requiredTokens) {
            expect(css.split(token).length).toBeGreaterThanOrEqual(4);
        }
        const lightDeclarations = [
            "--tme-toolbar-surface: #f7f7f7;",
            "--tme-toolbar-border: #b8b8b8;",
            "--tme-toolbar-button-surface: #ffffff;",
            "--tme-toolbar-button-border: #a8a8a8;",
            "--tme-toolbar-button-text: #202020;",
            "--tme-toolbar-button-icon: #202020;",
            "--tme-toolbar-button-hover-surface: #eeeeee;",
            "--tme-toolbar-focus-ring: #2563eb;",
            "--tme-toolbar-disabled-text: #777777;",
            "--tme-toolbar-menu-surface: #f7f7f7;",
            "--tme-toolbar-menu-border: #a8a8a8;",
            "--tme-toolbar-menu-shadow: 0 2px 8px rgba(0, 0, 0, 0.18);",
            "--tme-toolbar-menu-active-surface: #dbeafe;",
            "--tme-toolbar-menu-active-border: #60a5fa;",
            "--tme-toolbar-menu-active-text: #202020;",
            "--tme-toolbar-separator: #8c959f;"
        ];
        const darkDeclarations = [
            "--tme-toolbar-surface: #1f2937;",
            "--tme-toolbar-border: #9ca3af;",
            "--tme-toolbar-button-surface: #111827;",
            "--tme-toolbar-button-border: #9ca3af;",
            "--tme-toolbar-button-text: #f3f4f6;",
            "--tme-toolbar-button-icon: #f3f4f6;",
            "--tme-toolbar-button-hover-surface: #374151;",
            "--tme-toolbar-focus-ring: #bfdbfe;",
            "--tme-toolbar-disabled-text: #d1d5db;",
            "--tme-toolbar-menu-surface: #1f2937;",
            "--tme-toolbar-menu-border: #9ca3af;",
            "--tme-toolbar-menu-shadow: 0 2px 8px rgba(0, 0, 0, 0.5);",
            "--tme-toolbar-menu-active-surface: #1e3a8a;",
            "--tme-toolbar-menu-active-border: #bfdbfe;",
            "--tme-toolbar-menu-active-text: #ffffff;",
            "--tme-toolbar-separator: #9ca3af;"
        ];
        for (const declaration of [...lightDeclarations, ...darkDeclarations]) {
            expect(css).toContain(declaration);
        }
        expect(css).toContain('[data-tampermonkey-markdown-enhancer-color-scheme="light"]');
        expect(css).toContain('[data-tampermonkey-markdown-enhancer-color-scheme="dark"]');
        expect(css).toContain("color-scheme: light !important");
        expect(css).toContain("color-scheme: dark !important");
        expect(css).toContain("fill: currentColor");
        expect(css).toContain("font-weight: 600 !important");
        expect(css).toContain("__menu-separator");
        expect(css).toContain("align-self: stretch !important");
        expect(css).toContain("border-top: 1px solid var(--tme-toolbar-separator) !important");
        expect(css).toContain("__menu-item--active");
        expect(css).toContain(`
.tampermonkey-markdown-enhancer-formatting-toolbar button:disabled .${TOOLBAR_ICON_CLASS},
.tampermonkey-markdown-enhancer-formatting-toolbar button[aria-disabled="true"] .${TOOLBAR_ICON_CLASS} {
    color: inherit !important;
}
`);
        expect(css).toContain(`
.tampermonkey-markdown-enhancer-formatting-toolbar__menu-panel .tampermonkey-markdown-enhancer-formatting-toolbar__menu-item--active .${TOOLBAR_ICON_CLASS} {
    color: inherit !important;
}
`);
        expect(css).toContain(`
.tampermonkey-markdown-enhancer-formatting-toolbar__menu-panel .tampermonkey-markdown-enhancer-formatting-toolbar__menu-item--active:hover:not(:disabled):not([aria-disabled="true"]),
.tampermonkey-markdown-enhancer-formatting-toolbar__menu-panel .tampermonkey-markdown-enhancer-formatting-toolbar__menu-item--active:focus-visible {
    background: var(--tme-toolbar-menu-active-surface) !important;
    border-color: var(--tme-toolbar-menu-active-border) !important;
    color: var(--tme-toolbar-menu-active-text) !important;
}
`);
        expect(css).toContain(`
.tampermonkey-markdown-enhancer-formatting-toolbar button:focus-visible {
    outline: 2px solid var(--tme-toolbar-focus-ring) !important;
    outline-offset: 1px !important;
}
`);

        const forcedColorsIndex = css.indexOf("@media (forced-colors: active)");
        expect(forcedColorsIndex).toBeGreaterThan(css.indexOf("color-scheme: dark !important"));
        const forcedColorsCss = css.slice(forcedColorsIndex);
        expect(forcedColorsCss).toContain("background: Canvas");
        expect(forcedColorsCss).toContain("background: ButtonFace");
        expect(forcedColorsCss).toContain("border-color: ButtonText");
        expect(forcedColorsCss).toContain("color: GrayText");
        expect(forcedColorsCss).toContain("opacity: 1 !important");
        expect(forcedColorsCss).toContain("border-top-color: CanvasText !important");
        expect(forcedColorsCss).toContain("background: Highlight");
        expect(forcedColorsCss).toContain("color: HighlightText");
        expect(forcedColorsCss).toContain(`
    .tampermonkey-markdown-enhancer-formatting-toolbar__menu-panel .tampermonkey-markdown-enhancer-formatting-toolbar__menu-item--active:hover:not(:disabled):not([aria-disabled="true"]),
    .tampermonkey-markdown-enhancer-formatting-toolbar__menu-panel .tampermonkey-markdown-enhancer-formatting-toolbar__menu-item--active:focus-visible {
        background: Highlight !important;
        border-color: Highlight !important;
        color: HighlightText !important;
    }
`);
        expect(forcedColorsCss).toContain(`
    .tampermonkey-markdown-enhancer-formatting-toolbar__menu-panel .tampermonkey-markdown-enhancer-formatting-toolbar__menu-item--active[aria-disabled="true"] {
        background: Highlight !important;
        border-color: Highlight !important;
        color: HighlightText !important;
        opacity: 1 !important;
    }
`);
    });

    test("meets numeric contrast thresholds for enabled text, focus, and dark controls", () => {
        fixture = createFixture();
        const textArea = createTextArea();
        textArea.focus();
        const css = fixture.getToolbar()?.querySelector("style")?.textContent;
        if (!css) {
            throw new Error("Expected toolbar styles");
        }

        const enabledTextPairs = [
            ["--tme-toolbar-button-text", "--tme-toolbar-button-surface"],
            ["--tme-toolbar-button-text", "--tme-toolbar-button-hover-surface"],
            ["--tme-toolbar-button-icon", "--tme-toolbar-button-surface"],
            ["--tme-toolbar-menu-active-text", "--tme-toolbar-menu-active-surface"]
        ] as const;
        const focusPairs = [
            ["--tme-toolbar-focus-ring", "--tme-toolbar-button-surface"],
            ["--tme-toolbar-focus-ring", "--tme-toolbar-button-hover-surface"],
            ["--tme-toolbar-focus-ring", "--tme-toolbar-menu-active-surface"]
        ] as const;
        const darkControlPairs = [
            ["--tme-toolbar-border", "--tme-toolbar-surface"],
            ["--tme-toolbar-button-border", "--tme-toolbar-button-surface"],
            ["--tme-toolbar-button-border", "--tme-toolbar-surface"],
            ["--tme-toolbar-button-border", "--tme-toolbar-button-hover-surface"],
            ["--tme-toolbar-menu-border", "--tme-toolbar-menu-surface"],
            ["--tme-toolbar-separator", "--tme-toolbar-menu-surface"],
            ["--tme-toolbar-menu-active-border", "--tme-toolbar-menu-active-surface"],
            ["--tme-toolbar-menu-active-border", "--tme-toolbar-menu-surface"]
        ] as const;
        const expectContrastAtLeast = (
            tokens: ReadonlyMap<string, string>,
            scheme: "light" | "dark",
            tokenPairs: readonly (readonly [string, string])[],
            threshold: number
        ): void => {
            for (const [foregroundToken, backgroundToken] of tokenPairs) {
                const contrast = calculateContrastRatio(
                    getColorToken(tokens, foregroundToken),
                    getColorToken(tokens, backgroundToken)
                );
                expect(contrast, `${scheme} ${foregroundToken} against ${backgroundToken}`).toBeGreaterThanOrEqual(
                    threshold
                );
            }
        };

        for (const scheme of ["light", "dark"] as const) {
            const tokens = readColorTokens(css, scheme);
            expectContrastAtLeast(tokens, scheme, enabledTextPairs, 4.5);
            expectContrastAtLeast(tokens, scheme, focusPairs, 3);
        }
        expectContrastAtLeast(readColorTokens(css, "dark"), "dark", darkControlPairs, 3);
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
