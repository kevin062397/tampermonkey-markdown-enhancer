import {
    CONCRETE_BLOCK_STYLES,
    getActiveBlockStyle,
    type ActiveBlockStyle,
    type ConcreteBlockStyle
} from "./block-styles";
import { EDITOR_COMMAND_IDS, type EditorCommand, type EditorCommandRegistry } from "./command-registry";
import type { EditorToolbarPlacement } from "./editor-adapter";
import { readEditorState } from "./editor-state";
import {
    createToolbarBlockStyleIcon,
    createToolbarCaretDownIcon,
    createToolbarCommandIcon,
    createToolbarMixedIcon,
    createToolbarMoreIcon,
    createToolbarTextIcon,
    TOOLBAR_ICON_CLASS
} from "./formatting-toolbar-icons";

export interface FormattingToolbarEditor {
    readonly textArea: HTMLTextAreaElement;
    readonly commandRegistry: EditorCommandRegistry;
    readonly toolbarPlacement: EditorToolbarPlacement;
    readonly shouldDispatchChangeEventAfterEdit: boolean;
}

export interface FormattingToolbarOptions {
    readonly resolveEditor: (event: Event) => FormattingToolbarEditor | null;
    readonly resolveEditorFromTextArea: (textArea: HTMLTextAreaElement) => FormattingToolbarEditor | null;
    readonly subscribeSettings?: (listener: () => void) => () => void;
    readonly subscribeKeydown?: (listener: (event: KeyboardEvent) => void) => () => void;
}

interface EditorSelection {
    readonly start: number;
    readonly end: number;
    readonly direction: "forward" | "backward" | "none";
}

type ToolbarRoot = Document | ShadowRoot;
type MenuName = "style" | "more";
type MenuFocusTarget = "first" | "last" | undefined;
type ToolbarFocusTarget =
    | { readonly kind: "command"; readonly commandId: string }
    | {
          readonly kind: "menu-item";
          readonly blockStyle?: string;
          readonly commandId?: string;
          readonly menuName: MenuName;
      }
    | { readonly kind: "menu-trigger"; readonly menuName: MenuName };

const TOOLBAR_CLASS = "tampermonkey-markdown-enhancer-formatting-toolbar";
const TOOLBAR_DATA_ATTRIBUTE = "data-tampermonkey-markdown-enhancer-formatting-toolbar";
const MENU_PANEL_CLASS = `${TOOLBAR_CLASS}__menu-panel`;
const MENU_WRAPPER_CLASS = `${TOOLBAR_CLASS}__menu-wrapper`;
const MENU_SEPARATOR_CLASS = `${TOOLBAR_CLASS}__menu-separator`;
const ACTIVE_MENU_ITEM_CLASS = `${TOOLBAR_CLASS}__menu-item--active`;
const BUTTON_LABEL_CLASS = `${TOOLBAR_CLASS}__label`;
const CARET_ICON_CLASS = `${TOOLBAR_CLASS}__caret`;

const PRIMARY_COMMANDS: readonly string[] = [
    EDITOR_COMMAND_IDS.bold,
    EDITOR_COMMAND_IDS.italic,
    EDITOR_COMMAND_IDS.strikethrough,
    EDITOR_COMMAND_IDS.inlineCode,
    EDITOR_COMMAND_IDS.link
];

const PRIMARY_COMMAND_IDS = new Set(PRIMARY_COMMANDS);
const BLOCK_STYLE_SET = new Set<ConcreteBlockStyle>(CONCRETE_BLOCK_STYLES);

const TOOLBAR_STYLES = `
.${TOOLBAR_CLASS} {
    all: initial !important;
    align-items: center !important;
    background: #f7f7f7 !important;
    border: 1px solid #b8b8b8 !important;
    border-radius: 4px !important;
    box-sizing: border-box !important;
    display: flex !important;
    flex-wrap: wrap !important;
    gap: 2px !important;
    margin: 4px 0 !important;
    max-width: 100% !important;
    padding: 3px !important;
    position: relative !important;
    width: fit-content !important;
    z-index: 2147483646 !important;
}
.${TOOLBAR_CLASS} *,
.${TOOLBAR_CLASS} *::before,
.${TOOLBAR_CLASS} *::after {
    box-sizing: border-box !important;
}
.${TOOLBAR_CLASS} button {
    all: initial !important;
    align-items: center !important;
    background: #ffffff !important;
    border: 1px solid #a8a8a8 !important;
    border-radius: 3px !important;
    color: #202020 !important;
    cursor: pointer !important;
    display: inline-flex !important;
    font: 600 12px/1.2 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif !important;
    gap: 5px !important;
    justify-content: center !important;
    min-height: 26px !important;
    min-width: 28px !important;
    padding: 5px 7px !important;
    text-align: center !important;
    white-space: nowrap !important;
}
.${TOOLBAR_CLASS} button:hover:not(:disabled):not([aria-disabled="true"]) {
    background: #eeeeee !important;
}
.${TOOLBAR_CLASS} button:focus-visible {
    outline: 2px solid #2563eb !important;
    outline-offset: 1px !important;
}
.${TOOLBAR_CLASS} button:disabled,
.${TOOLBAR_CLASS} button[aria-disabled="true"] {
    color: #777777 !important;
    cursor: default !important;
    opacity: 0.55 !important;
}
.${TOOLBAR_CLASS} .${TOOLBAR_ICON_CLASS} {
    display: block !important;
    fill: currentColor !important;
    flex: none !important;
    height: 16px !important;
    width: 16px !important;
}
.${TOOLBAR_CLASS} .${CARET_ICON_CLASS} {
    height: 12px !important;
    margin-left: 1px !important;
    width: 12px !important;
}
.${TOOLBAR_CLASS} .${BUTTON_LABEL_CLASS} {
    display: inline-block !important;
}
.${MENU_WRAPPER_CLASS} {
    all: initial !important;
    display: inline-flex !important;
    position: relative !important;
}
.${MENU_PANEL_CLASS} {
    all: initial !important;
    background: #f7f7f7 !important;
    border: 1px solid #a8a8a8 !important;
    border-radius: 4px !important;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.18) !important;
    display: grid !important;
    gap: 2px !important;
    left: 0 !important;
    max-height: 320px !important;
    min-width: 170px !important;
    overflow: auto !important;
    padding: 3px !important;
    position: absolute !important;
    top: calc(100% + 3px) !important;
    z-index: 2147483647 !important;
}
.${MENU_PANEL_CLASS}[hidden] {
    display: none !important;
}
.${MENU_PANEL_CLASS} button {
    font-weight: 600 !important;
    justify-content: flex-start !important;
    width: 100% !important;
}
.${MENU_PANEL_CLASS} .${ACTIVE_MENU_ITEM_CLASS} {
    background: #dbeafe !important;
    border-color: #60a5fa !important;
}
.${MENU_SEPARATOR_CLASS} {
    all: initial !important;
    align-self: stretch !important;
    border: 0 !important;
    border-top: 1px solid #8c959f !important;
    display: block !important;
    height: 0 !important;
    margin: 4px 2px !important;
}
@media (forced-colors: active) {
    .${TOOLBAR_CLASS},
    .${MENU_PANEL_CLASS} {
        background: Canvas !important;
        border-color: CanvasText !important;
    }
    .${MENU_PANEL_CLASS} {
        box-shadow: none !important;
    }
    .${TOOLBAR_CLASS} button {
        background: ButtonFace !important;
        border-color: ButtonText !important;
        color: ButtonText !important;
        forced-color-adjust: auto !important;
    }
    .${TOOLBAR_CLASS} button:hover:not(:disabled):not([aria-disabled="true"]),
    .${MENU_PANEL_CLASS} .${ACTIVE_MENU_ITEM_CLASS} {
        background: Highlight !important;
        border-color: Highlight !important;
        color: HighlightText !important;
    }
    .${TOOLBAR_CLASS} button:focus-visible {
        outline-color: Highlight !important;
    }
    .${TOOLBAR_CLASS} button:disabled,
    .${TOOLBAR_CLASS} button[aria-disabled="true"] {
        color: GrayText !important;
        opacity: 1 !important;
    }
    .${MENU_PANEL_CLASS} .${ACTIVE_MENU_ITEM_CLASS}[aria-disabled="true"] {
        background: Highlight !important;
        border-color: Highlight !important;
        color: HighlightText !important;
        opacity: 1 !important;
    }
    .${MENU_SEPARATOR_CLASS} {
        border-top-color: CanvasText !important;
    }
}
`;

let toolbarSequence = 0;

const isNode = (value: unknown): value is Node =>
    typeof value === "object" &&
    value !== null &&
    "nodeType" in value &&
    typeof (value as { readonly nodeType?: unknown }).nodeType === "number";

const isElement = (value: unknown): value is Element =>
    isNode(value) && value.nodeType === 1 && typeof (value as Element).localName === "string";

const isButtonElement = (value: unknown): value is HTMLButtonElement =>
    isElement(value) && value.localName === "button" && typeof (value as HTMLButtonElement).disabled === "boolean";

const isTextAreaElement = (value: unknown): value is HTMLTextAreaElement =>
    isElement(value) &&
    value.localName === "textarea" &&
    typeof (value as HTMLTextAreaElement).selectionStart === "number" &&
    typeof (value as HTMLTextAreaElement).setSelectionRange === "function";

const isDocument = (value: unknown): value is Document => isNode(value) && value.nodeType === 9;

const isShadowRoot = (value: unknown): value is ShadowRoot =>
    isNode(value) && value.nodeType === 11 && "host" in value && isElement((value as { readonly host?: unknown }).host);

const isFocusableElement = (value: unknown): value is HTMLElement =>
    isElement(value) && typeof (value as HTMLElement).focus === "function";

const getEditorRoot = (textArea: HTMLTextAreaElement): ToolbarRoot => {
    const root = textArea.getRootNode();
    return isShadowRoot(root) ? root : textArea.ownerDocument;
};

const getDeepActiveElement = (ownerDocument: Document = document): Element | null => {
    let activeElement = ownerDocument.activeElement;
    while (activeElement?.shadowRoot?.activeElement) {
        activeElement = activeElement.shadowRoot.activeElement;
    }
    return activeElement;
};

const isDocumentBrowsingContextConnected = (ownerDocument: Document, initialDocument: Document): boolean => {
    if (ownerDocument === initialDocument || !ownerDocument.defaultView) {
        return true;
    }
    if (ownerDocument.defaultView.closed) {
        return false;
    }
    try {
        const frameElement = ownerDocument.defaultView.frameElement;
        return frameElement === null || frameElement.isConnected;
    } catch {
        return true;
    }
};

const createToolbarStyle = (): HTMLStyleElement => {
    const style = document.createElement("style");
    style.dataset.tampermonkeyMarkdownEnhancerFormattingToolbarStyle = "";
    style.textContent = TOOLBAR_STYLES;
    return style;
};

const captureEditorSelection = (textArea: HTMLTextAreaElement): EditorSelection => ({
    start: textArea.selectionStart,
    end: textArea.selectionEnd,
    direction: textArea.selectionDirection
});

const restoreEditorSelection = (textArea: HTMLTextAreaElement, selection: EditorSelection): void => {
    textArea.setSelectionRange(selection.start, selection.end, selection.direction);
};

const dispatchChangeEventIfRequired = (editor: FormattingToolbarEditor, valueBeforeEdit: string): void => {
    const isValueChanged = editor.textArea.value !== valueBeforeEdit;
    if (editor.shouldDispatchChangeEventAfterEdit && isValueChanged) {
        editor.textArea.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
    }
};

const focusElementWithoutScrolling = (element: HTMLElement): void => {
    element.focus({ preventScroll: true });
};

const isMenuButtonAvailable = (button: HTMLButtonElement): boolean =>
    !button.disabled && button.getAttribute("aria-disabled") !== "true";

const getAvailableMenuButtons = (panel: ParentNode): HTMLButtonElement[] =>
    Array.from(panel.querySelectorAll<HTMLButtonElement>("button")).filter(isMenuButtonAvailable);

const getNavigableMenuButtons = (panel: ParentNode): HTMLButtonElement[] => {
    const buttons = Array.from(panel.querySelectorAll<HTMLButtonElement>("button"));
    return isElement(panel) && panel.getAttribute("data-toolbar-menu") === "style"
        ? buttons
        : buttons.filter(isMenuButtonAvailable);
};

const moveMenuButtonFocus = (panel: ParentNode, current: HTMLButtonElement, offset: number): void => {
    const buttons = getNavigableMenuButtons(panel);
    const currentIndex = buttons.indexOf(current);
    if (currentIndex < 0 || buttons.length === 0) {
        return;
    }
    const nextIndex = (currentIndex + offset + buttons.length) % buttons.length;
    focusElementWithoutScrolling(buttons[nextIndex]);
};

const isConcreteBlockStyle = (blockStyle: ConcreteBlockStyle | undefined): blockStyle is ConcreteBlockStyle =>
    blockStyle !== undefined && BLOCK_STYLE_SET.has(blockStyle);

export const attachFormattingToolbar = (options: FormattingToolbarOptions): (() => void) => {
    const container = document.createElement("div");
    container.className = TOOLBAR_CLASS;
    container.setAttribute(TOOLBAR_DATA_ATTRIBUTE, "");
    container.setAttribute("role", "toolbar");
    container.setAttribute("aria-label", "Markdown formatting");

    const style = createToolbarStyle();
    const initialDocument = document;
    let activeEditor: FormattingToolbarEditor | undefined;
    let savedSelection: EditorSelection | undefined;
    let stylePanel: HTMLElement | undefined;
    let styleTrigger: HTMLButtonElement | undefined;
    let styleTriggerIcon: SVGSVGElement | undefined;
    let styleTriggerLabel: HTMLElement | undefined;
    let morePanel: HTMLElement | undefined;
    let moreTrigger: HTMLButtonElement | undefined;
    let activeBlockStyle: ActiveBlockStyle = "text";
    let renderedStylePresentation = "";
    let renderedCommandPresentation = "";
    let renderedToolbarRoot: ToolbarRoot | undefined;
    let isDisposed = false;
    let isRefreshQueued = false;
    let observer: MutationObserver | undefined;
    const styleCommandsByStyle = new Map<ConcreteBlockStyle, EditorCommand>();
    const documentListenerModes = new Map<Document, "active" | "discovery">();
    let retainedDiscoveryDocument = initialDocument;
    const selectionChangeRoots = new Set<ShadowRoot>();
    const outsidePointerRoots = new Set<ToolbarRoot>();
    const deferredOutsidePointerDismissals = new WeakMap<Event, object>();

    let placedToolbarAncestors: readonly Node[] = [];
    let pointerToggleFocusTrigger: HTMLButtonElement | undefined;
    let lastToolbarFocusTarget: ToolbarFocusTarget | undefined;

    const resolveEventPath = (
        event: Event
    ): { readonly isTargetFallback: boolean; readonly path: readonly EventTarget[] } => {
        try {
            const path = typeof event.composedPath === "function" ? event.composedPath() : [];
            if (path.length > 0) {
                return { isTargetFallback: false, path };
            }
        } catch {
            // Fall through to the event target supplied by the dispatching root.
        }
        return { isTargetFallback: true, path: event.target ? [event.target] : [] };
    };

    const isEventWithinElement = (
        event: Event,
        element: Element,
        path: readonly EventTarget[] = resolveEventPath(event).path
    ): boolean => {
        if (path.includes(element)) {
            return true;
        }
        return isNode(event.target) && element.contains(event.target);
    };

    const isToolbarEvent = (event: Event): boolean => isEventWithinElement(event, container);

    const resolveEditorForEvent = (event: Event): FormattingToolbarEditor | null => {
        const resolvedEditor = options.resolveEditor(event);
        if (resolvedEditor) {
            return resolvedEditor;
        }
        const textArea = resolveEventPath(event).path.find(isTextAreaElement);
        return textArea ? options.resolveEditorFromTextArea(textArea) : null;
    };

    const isToolbarFocused = (): boolean => {
        const activeElement = getDeepActiveElement(activeEditor?.textArea.ownerDocument ?? container.ownerDocument);
        return isNode(activeElement) && container.contains(activeElement);
    };

    const getEnclosingToolbarRoots = (): ToolbarRoot[] => {
        const roots: ToolbarRoot[] = [];
        let root = container.getRootNode();
        while (isShadowRoot(root)) {
            roots.push(root);
            root = root.host.getRootNode();
        }
        roots.push(container.ownerDocument);
        return roots;
    };

    const getToolbarAncestors = (): Node[] => {
        const ancestors: Node[] = [];
        let current: Node | null = container.parentNode;
        while (current) {
            ancestors.push(current);
            current = current.parentNode ?? (isShadowRoot(current) ? current.host : null);
        }
        return ancestors;
    };

    const areToolbarAncestorsCurrent = (): boolean => {
        const ancestors = getToolbarAncestors();
        return (
            ancestors.length === placedToolbarAncestors.length &&
            ancestors.every((ancestor, index) => ancestor === placedToolbarAncestors[index])
        );
    };

    const getOpenMenuPanel = (): HTMLElement | undefined => {
        if (stylePanel && !stylePanel.hidden) {
            return stylePanel;
        }
        return morePanel && !morePanel.hidden ? morePanel : undefined;
    };

    const getOpenMenuTrigger = (): HTMLButtonElement | undefined => {
        if (stylePanel && !stylePanel.hidden) {
            return styleTrigger;
        }
        return morePanel && !morePanel.hidden ? moreTrigger : undefined;
    };

    const getOpenMenuName = (): MenuName | undefined => {
        if (stylePanel && !stylePanel.hidden) {
            return "style";
        }
        return morePanel && !morePanel.hidden ? "more" : undefined;
    };

    const getMenuTriggerByName = (menuName: MenuName): HTMLButtonElement | undefined =>
        menuName === "style" ? styleTrigger : moreTrigger;

    const removeOutsidePointerDismissal = (): void => {
        for (const root of outsidePointerRoots) {
            root.removeEventListener("pointerdown", handleOutsidePointerDown, true);
        }
        outsidePointerRoots.clear();
    };

    const addOutsidePointerDismissal = (): void => {
        for (const root of getEnclosingToolbarRoots()) {
            if (!outsidePointerRoots.has(root)) {
                root.addEventListener("pointerdown", handleOutsidePointerDown, true);
                outsidePointerRoots.add(root);
            }
        }
    };

    const getTopLevelButtons = (): HTMLButtonElement[] =>
        Array.from(container.children).flatMap((child) => {
            if (isButtonElement(child)) {
                return [child];
            }
            return Array.from(child.children).filter(isButtonElement);
        });

    const setToolbarTabStop = (preferredButton?: HTMLButtonElement): void => {
        const buttons = getTopLevelButtons();
        const enabledButtons = buttons.filter((button) => !button.disabled);
        const currentButton = enabledButtons.find((button) => button.tabIndex === 0);
        const nextButton =
            preferredButton && enabledButtons.includes(preferredButton)
                ? preferredButton
                : (currentButton ?? enabledButtons[0]);
        for (const button of buttons) {
            button.tabIndex = button === nextButton ? 0 : -1;
        }
    };

    const moveToolbarButtonFocus = (current: HTMLButtonElement, offset: number): void => {
        const buttons = getTopLevelButtons().filter((button) => !button.disabled);
        const currentIndex = buttons.indexOf(current);
        if (currentIndex < 0 || buttons.length === 0) {
            return;
        }
        const nextButton = buttons[(currentIndex + offset + buttons.length) % buttons.length];
        setToolbarTabStop(nextButton);
        focusElementWithoutScrolling(nextButton);
    };

    const captureToolbarFocusTarget = (): ToolbarFocusTarget | undefined => {
        const activeElement = getDeepActiveElement(activeEditor?.textArea.ownerDocument ?? container.ownerDocument);
        if (!isButtonElement(activeElement) || !container.contains(activeElement)) {
            return undefined;
        }
        if (activeElement === styleTrigger) {
            return { kind: "menu-trigger", menuName: "style" };
        }
        if (activeElement === moreTrigger) {
            return { kind: "menu-trigger", menuName: "more" };
        }
        const panel = activeElement.closest<HTMLElement>(`.${MENU_PANEL_CLASS}`);
        const menuName = panel?.dataset.toolbarMenu;
        if (panel && container.contains(panel) && (menuName === "style" || menuName === "more")) {
            return {
                kind: "menu-item",
                menuName,
                blockStyle: activeElement.dataset.blockStyle,
                commandId: activeElement.dataset.commandId
            };
        }
        const commandId = activeElement.dataset.commandId;
        return commandId ? { kind: "command", commandId } : undefined;
    };

    const isRestorableToolbarButton = (button: HTMLButtonElement | undefined): button is HTMLButtonElement =>
        button !== undefined && button.isConnected && container.contains(button) && !button.disabled;

    const resolveFallbackToolbarButton = (target: ToolbarFocusTarget): HTMLButtonElement | undefined => {
        const menuTrigger = target.kind === "command" ? undefined : getMenuTriggerByName(target.menuName);
        const adjacentTrigger = target.kind !== "command" && target.menuName === "more" ? styleTrigger : undefined;
        return [menuTrigger, adjacentTrigger, ...getTopLevelButtons()].find(isRestorableToolbarButton);
    };

    const restoreToolbarFocusTarget = (target: ToolbarFocusTarget | undefined): void => {
        if (!target) {
            return;
        }
        let button: HTMLButtonElement | undefined;
        let panel: HTMLElement | undefined;
        let trigger: HTMLButtonElement | undefined;
        if (target.kind === "menu-trigger") {
            button = getMenuTriggerByName(target.menuName);
        } else if (target.kind === "menu-item") {
            panel = target.menuName === "style" ? stylePanel : morePanel;
            trigger = getMenuTriggerByName(target.menuName);
            button = panel
                ? Array.from(panel.querySelectorAll<HTMLButtonElement>("button")).find(
                      (candidate) =>
                          (target.blockStyle !== undefined && candidate.dataset.blockStyle === target.blockStyle) ||
                          (target.blockStyle === undefined &&
                              target.commandId !== undefined &&
                              candidate.dataset.commandId === target.commandId)
                  )
                : undefined;
        } else {
            button = getTopLevelButtons().find((candidate) => candidate.dataset.commandId === target.commandId);
        }
        if (!isRestorableToolbarButton(button)) {
            button = resolveFallbackToolbarButton(target);
            panel = undefined;
            trigger = undefined;
        }
        if (!button) {
            return;
        }
        if (target.kind === "menu-item" && panel && trigger) {
            closeOpenMenus();
            panel.hidden = false;
            trigger.setAttribute("aria-expanded", "true");
            addOutsidePointerDismissal();
        } else {
            setToolbarTabStop(button);
        }
        focusElementWithoutScrolling(button);
    };

    const createMenuPanelId = (root: ToolbarRoot, menuName: "style" | "more"): string => {
        const ownerDocument = root.nodeType === 9 ? (root as Document) : (root.ownerDocument ?? initialDocument);
        let panelId: string;
        do {
            panelId = `tampermonkey-markdown-enhancer-formatting-${menuName}-${toolbarSequence++}`;
        } while (ownerDocument.getElementById(panelId) || (root !== ownerDocument && root.getElementById(panelId)));
        return panelId;
    };

    const areMenuPanelIdsUnique = (root: ToolbarRoot): boolean =>
        (
            [
                [stylePanel, styleTrigger],
                [morePanel, moreTrigger]
            ] as const
        )
            .filter(
                (entry): entry is readonly [HTMLElement, HTMLButtonElement] =>
                    entry[0] !== undefined && entry[1] !== undefined
            )
            .every(
                ([panel, trigger]) =>
                    panel.getRootNode() === root &&
                    panel.id.length > 0 &&
                    trigger.getAttribute("aria-controls") === panel.id &&
                    Array.from(root.querySelectorAll<HTMLElement>("[id]")).filter((element) => element.id === panel.id)
                        .length === 1
            );

    const getCommandPresentation = (registry: EditorCommandRegistry): string =>
        JSON.stringify(registry.listCommands().map(({ id, label, blockStyle }) => [id, label, blockStyle ?? null]));

    const closeOpenMenus = (shouldFocusTrigger = false): void => {
        const openTrigger = getOpenMenuTrigger();
        removeOutsidePointerDismissal();
        if (stylePanel && styleTrigger) {
            stylePanel.hidden = true;
            styleTrigger.setAttribute("aria-expanded", "false");
        }
        if (morePanel && moreTrigger) {
            morePanel.hidden = true;
            moreTrigger.setAttribute("aria-expanded", "false");
        }
        if (shouldFocusTrigger && openTrigger) {
            setToolbarTabStop(openTrigger);
            focusElementWithoutScrolling(openTrigger);
        }
    };

    const createStyleTriggerIcon = (blockStyle: ActiveBlockStyle): SVGSVGElement => {
        if (blockStyle === "mixed") {
            return createToolbarMixedIcon();
        }
        return createToolbarBlockStyleIcon(blockStyle);
    };

    const refreshStylePresentation = (): void => {
        if (!activeEditor || !styleTrigger || !styleTriggerIcon || !styleTriggerLabel || !stylePanel) {
            return;
        }
        activeBlockStyle = getActiveBlockStyle(readEditorState(activeEditor.textArea));
        const activeCommand = activeBlockStyle === "mixed" ? undefined : styleCommandsByStyle.get(activeBlockStyle);
        const label = activeBlockStyle === "mixed" ? "Mixed" : (activeCommand?.label ?? "Text");
        const nextStylePresentation = JSON.stringify([activeBlockStyle, activeCommand?.id ?? null, label]);
        if (nextStylePresentation !== renderedStylePresentation) {
            const nextIcon = createStyleTriggerIcon(activeBlockStyle);
            styleTriggerIcon.replaceWith(nextIcon);
            styleTriggerIcon = nextIcon;
            styleTriggerLabel.textContent = label;
            styleTrigger.title = `Style: ${label}`;
            styleTrigger.setAttribute("aria-label", `Style: ${label}`);
            renderedStylePresentation = nextStylePresentation;
        }

        for (const button of stylePanel.querySelectorAll<HTMLButtonElement>("button[data-block-style]")) {
            const isActive = button.dataset.blockStyle === activeBlockStyle;
            button.setAttribute("aria-checked", String(isActive));
            button.classList.toggle(ACTIVE_MENU_ITEM_CLASS, isActive);
        }
    };

    const refreshToolbarState = (): void => {
        if (!activeEditor) {
            return;
        }
        const textArea = activeEditor.textArea;
        const actualSelection = savedSelection ? captureEditorSelection(textArea) : undefined;
        if (savedSelection) {
            restoreEditorSelection(textArea, savedSelection);
        }
        try {
            const context = { textArea };
            for (const button of container.querySelectorAll<HTMLButtonElement>("button[data-command-id]")) {
                const command = activeEditor.commandRegistry.getCommand(button.dataset.commandId ?? "");
                const isAvailable = command?.isAvailable(context) ?? false;
                if (button.getAttribute("role") === "menuitemradio") {
                    button.disabled = false;
                    button.setAttribute("aria-disabled", String(!isAvailable));
                } else {
                    button.disabled = !isAvailable;
                    button.removeAttribute("aria-disabled");
                }
            }
            refreshStylePresentation();
            if (styleTrigger && stylePanel) {
                styleTrigger.disabled = stylePanel.querySelectorAll("button").length === 0;
            }
            if (moreTrigger && morePanel) {
                moreTrigger.disabled = getAvailableMenuButtons(morePanel).length === 0;
            }
            setToolbarTabStop();
        } finally {
            if (actualSelection) {
                restoreEditorSelection(textArea, actualSelection);
            }
        }
    };

    const queueToolbarStateRefresh = (): void => {
        if (isRefreshQueued || isDisposed) {
            return;
        }
        isRefreshQueued = true;
        queueMicrotask(() => {
            isRefreshQueued = false;
            if (!isDisposed) {
                refreshToolbarState();
            }
        });
    };

    const createCommandButton = (command: EditorCommand, role?: "menuitem" | "menuitemradio"): HTMLButtonElement => {
        const button = document.createElement("button");
        button.type = "button";
        button.dataset.commandId = command.id;
        const icon =
            role === "menuitemradio" && isConcreteBlockStyle(command.blockStyle)
                ? createToolbarBlockStyleIcon(command.blockStyle)
                : createToolbarCommandIcon(command.id);
        button.append(icon);
        button.title = command.label;
        button.setAttribute("aria-label", command.label);
        button.tabIndex = -1;
        if (role) {
            const label = document.createElement("span");
            label.className = BUTTON_LABEL_CLASS;
            label.textContent = command.label;
            button.append(label);
            button.setAttribute("role", role);
        }
        if (role === "menuitemradio" && command.blockStyle) {
            button.dataset.blockStyle = command.blockStyle;
            button.setAttribute("aria-checked", "false");
        }
        return button;
    };

    const createMenuSeparator = (): HTMLElement => {
        const separator = document.createElement("span");
        separator.className = MENU_SEPARATOR_CLASS;
        separator.setAttribute("role", "separator");
        return separator;
    };

    const createMenuWrapper = (trigger: HTMLButtonElement, panel: HTMLElement): HTMLElement => {
        const wrapper = document.createElement("span");
        wrapper.className = MENU_WRAPPER_CLASS;
        wrapper.append(trigger, panel);
        return wrapper;
    };

    const openStyleMenu = (): void => {
        if (!stylePanel || !styleTrigger || styleTrigger.disabled) {
            return;
        }
        const isAlreadyOpen = !stylePanel.hidden;
        if (!isAlreadyOpen) {
            closeOpenMenus();
        }
        refreshToolbarState();
        stylePanel.hidden = false;
        styleTrigger.setAttribute("aria-expanded", "true");
        if (!isAlreadyOpen) {
            addOutsidePointerDismissal();
        }
        const focusStyle = activeBlockStyle === "mixed" ? "text" : activeBlockStyle;
        const activeButton = stylePanel.querySelector<HTMLButtonElement>(`button[data-block-style="${focusStyle}"]`);
        const focusButton = activeButton ?? getNavigableMenuButtons(stylePanel)[0];
        if (focusButton) {
            focusElementWithoutScrolling(focusButton);
        }
    };

    const openMoreMenu = (focusTarget: MenuFocusTarget = undefined): void => {
        if (!morePanel || !moreTrigger || moreTrigger.disabled) {
            return;
        }
        const isAlreadyOpen = !morePanel.hidden;
        if (!isAlreadyOpen) {
            closeOpenMenus();
        }
        refreshToolbarState();
        morePanel.hidden = false;
        moreTrigger.setAttribute("aria-expanded", "true");
        if (!isAlreadyOpen) {
            addOutsidePointerDismissal();
        }
        if (focusTarget) {
            const commands = getAvailableMenuButtons(morePanel);
            const command = focusTarget === "first" ? commands[0] : commands.at(-1);
            if (command) {
                focusElementWithoutScrolling(command);
            }
        }
    };

    const renderCommands = (registry: EditorCommandRegistry, root: ToolbarRoot): void => {
        closeOpenMenus();
        const commands = registry.listCommands();
        const commandsById = new Map(commands.map((command) => [command.id, command]));
        const elements: Node[] = [style];
        styleCommandsByStyle.clear();
        renderedStylePresentation = "";

        for (const command of commands) {
            if (isConcreteBlockStyle(command.blockStyle) && !styleCommandsByStyle.has(command.blockStyle)) {
                styleCommandsByStyle.set(command.blockStyle, command);
            }
        }

        for (const commandId of PRIMARY_COMMANDS) {
            const command = commandsById.get(commandId);
            if (command) {
                elements.push(createCommandButton(command));
            }
        }

        const stylePanelId = createMenuPanelId(root, "style");
        styleTrigger = document.createElement("button");
        styleTrigger.type = "button";
        styleTrigger.dataset.toolbarMenuTrigger = "style";
        styleTriggerIcon = createToolbarTextIcon();
        styleTriggerLabel = document.createElement("span");
        styleTriggerLabel.className = BUTTON_LABEL_CLASS;
        styleTriggerLabel.textContent = "Text";
        const caretIcon = createToolbarCaretDownIcon();
        caretIcon.classList.add(CARET_ICON_CLASS);
        styleTrigger.append(styleTriggerIcon, styleTriggerLabel, caretIcon);
        styleTrigger.title = "Style: Text";
        styleTrigger.setAttribute("aria-label", "Style: Text");
        styleTrigger.setAttribute("aria-haspopup", "menu");
        styleTrigger.setAttribute("aria-expanded", "false");
        styleTrigger.setAttribute("aria-controls", stylePanelId);
        styleTrigger.tabIndex = -1;

        stylePanel = document.createElement("div");
        stylePanel.id = stylePanelId;
        stylePanel.className = MENU_PANEL_CLASS;
        stylePanel.dataset.toolbarMenu = "style";
        stylePanel.hidden = true;
        stylePanel.setAttribute("role", "menu");
        stylePanel.setAttribute("aria-label", "Style");
        for (const blockStyle of CONCRETE_BLOCK_STYLES) {
            if (blockStyle === "blockquote" || blockStyle === "bulletList") {
                stylePanel.append(createMenuSeparator());
            }
            const command = styleCommandsByStyle.get(blockStyle);
            if (command) {
                stylePanel.append(createCommandButton(command, "menuitemradio"));
            }
        }
        elements.push(createMenuWrapper(styleTrigger, stylePanel));

        const moreCommands = commands.filter(
            (command) => !PRIMARY_COMMAND_IDS.has(command.id) && !isConcreteBlockStyle(command.blockStyle)
        );
        if (moreCommands.length > 0) {
            const morePanelId = createMenuPanelId(root, "more");
            moreTrigger = document.createElement("button");
            moreTrigger.type = "button";
            moreTrigger.dataset.toolbarMenuTrigger = "more";
            const moreLabel = document.createElement("span");
            moreLabel.className = BUTTON_LABEL_CLASS;
            moreLabel.textContent = "More";
            moreTrigger.append(createToolbarMoreIcon(), moreLabel);
            moreTrigger.title = "More formatting commands";
            moreTrigger.setAttribute("aria-label", "More formatting commands");
            moreTrigger.setAttribute("aria-haspopup", "menu");
            moreTrigger.setAttribute("aria-expanded", "false");
            moreTrigger.setAttribute("aria-controls", morePanelId);
            moreTrigger.tabIndex = -1;

            morePanel = document.createElement("div");
            morePanel.id = morePanelId;
            morePanel.className = MENU_PANEL_CLASS;
            morePanel.dataset.toolbarMenu = "more";
            morePanel.hidden = true;
            morePanel.setAttribute("role", "menu");
            morePanel.setAttribute("aria-label", "More formatting commands");
            for (const command of moreCommands) {
                morePanel.append(createCommandButton(command, "menuitem"));
            }
            elements.push(createMenuWrapper(moreTrigger, morePanel));
        } else {
            morePanel = undefined;
            moreTrigger = undefined;
        }

        container.replaceChildren(...elements);
        renderedCommandPresentation = getCommandPresentation(registry);
        renderedToolbarRoot = root;
        refreshToolbarState();
    };

    const getEditorShadowRoots = (editor: FormattingToolbarEditor): ShadowRoot[] => {
        const roots: ShadowRoot[] = [];
        let root = editor.textArea.getRootNode();
        while (isShadowRoot(root)) {
            roots.push(root);
            root = root.host.getRootNode();
        }
        return roots;
    };

    const syncSelectionChangeRoots = (roots: readonly ShadowRoot[]): void => {
        const nextRoots = new Set(roots);
        for (const root of selectionChangeRoots) {
            if (!nextRoots.has(root)) {
                root.removeEventListener("selectionchange", handleSelectionChange);
                selectionChangeRoots.delete(root);
            }
        }
        for (const root of nextRoots) {
            if (!selectionChangeRoots.has(root)) {
                root.addEventListener("selectionchange", handleSelectionChange);
                selectionChangeRoots.add(root);
            }
        }
    };

    const observeMutationRoot = (root: ToolbarRoot): void => {
        const target = isDocument(root) ? root.documentElement : root;
        observer?.observe(target, {
            attributeFilter: ["id"],
            attributes: true,
            childList: true,
            subtree: true
        });
    };

    const observeEditorRoot = (editor: FormattingToolbarEditor): FormattingToolbarEditor | undefined => {
        const ownerDocument = editor.textArea.ownerDocument;
        syncDocumentEventListeners(ownerDocument);
        const destinationActiveElement = getDeepActiveElement(ownerDocument);
        if (isTextAreaElement(destinationActiveElement) && destinationActiveElement !== editor.textArea) {
            const destinationEditor = options.resolveEditorFromTextArea(destinationActiveElement);
            if (destinationEditor) {
                return destinationEditor;
            }
        }
        const shadowRoots = getEditorShadowRoots(editor);
        syncSelectionChangeRoots(shadowRoots);
        observer?.disconnect();
        observeMutationRoot(initialDocument);
        if (ownerDocument !== initialDocument) {
            observeMutationRoot(ownerDocument);
        }
        for (const root of shadowRoots) {
            observeMutationRoot(root);
        }
        observer?.observe(editor.textArea, { attributes: true });
        return undefined;
    };

    const retainDiscoveryDocument = (): void => {
        syncDocumentEventListeners();
        syncSelectionChangeRoots([]);
        observer?.disconnect();
    };

    const isToolbarPlaced = (editor: FormattingToolbarEditor): boolean => {
        if (!editor.textArea.parentNode) {
            return false;
        }
        return editor.toolbarPlacement === "before-editor"
            ? editor.textArea.previousSibling === container
            : editor.textArea.nextSibling === container;
    };

    const placeToolbar = (editor: FormattingToolbarEditor): void => {
        const parent = editor.textArea.parentNode;
        if (!parent) {
            return;
        }
        if (editor.toolbarPlacement === "before-editor") {
            if (editor.textArea.previousSibling !== container) {
                parent.insertBefore(container, editor.textArea);
            }
        } else if (editor.textArea.nextSibling !== container) {
            parent.insertBefore(container, editor.textArea.nextSibling);
        }
        placedToolbarAncestors = getToolbarAncestors();
    };

    const removeToolbar = (): void => {
        closeOpenMenus();
        container.remove();
        placedToolbarAncestors = [];
        activeEditor = undefined;
        savedSelection = undefined;
        lastToolbarFocusTarget = undefined;
        retainDiscoveryDocument();
    };

    const activateEditor = (editor: FormattingToolbarEditor): FormattingToolbarEditor => {
        const isSameEditor = activeEditor?.textArea === editor.textArea;
        const root = getEditorRoot(editor.textArea);
        const isRootChanged = root !== renderedToolbarRoot;
        const areMenuIdsCurrent = areMenuPanelIdsUnique(root);
        const commandPresentation = getCommandPresentation(editor.commandRegistry);
        const isCommandPresentationChanged = commandPresentation !== renderedCommandPresentation;
        const shouldRepairToolbar =
            !isSameEditor ||
            isRootChanged ||
            !areMenuIdsCurrent ||
            isCommandPresentationChanged ||
            !isToolbarPlaced(editor) ||
            !areToolbarAncestorsCurrent();
        const capturedToolbarFocusTarget = shouldRepairToolbar ? captureToolbarFocusTarget() : undefined;
        const toolbarFocusTarget = shouldRepairToolbar
            ? (capturedToolbarFocusTarget ?? (isSameEditor ? lastToolbarFocusTarget : undefined))
            : undefined;
        if (shouldRepairToolbar) {
            closeOpenMenus();
        }
        activeEditor = editor;
        if (!isSameEditor || !savedSelection) {
            savedSelection = captureEditorSelection(editor.textArea);
        }
        const destinationEditor = observeEditorRoot(editor);
        if (destinationEditor && destinationEditor.textArea !== editor.textArea) {
            return activateEditor(destinationEditor);
        }
        if (!isSameEditor || isRootChanged || !areMenuIdsCurrent || isCommandPresentationChanged) {
            renderCommands(editor.commandRegistry, root);
        }
        placeToolbar(editor);
        refreshToolbarState();
        restoreToolbarFocusTarget(toolbarFocusTarget);
        return editor;
    };

    function reconcileActiveEditor(): FormattingToolbarEditor | null {
        const textArea = activeEditor?.textArea;
        const isBrowsingContextConnected =
            textArea !== undefined && isDocumentBrowsingContextConnected(textArea.ownerDocument, initialDocument);
        if (!textArea || !textArea.isConnected || !isBrowsingContextConnected) {
            if (!isBrowsingContextConnected) {
                retainedDiscoveryDocument = initialDocument;
            }
            if (activeEditor) {
                removeToolbar();
            }
            return null;
        }
        const resolvedEditor = options.resolveEditorFromTextArea(textArea);
        if (!resolvedEditor) {
            removeToolbar();
            return null;
        }
        return activateEditor(resolvedEditor);
    }

    const executeToolbarCommand = (commandId: string): void => {
        const selectionBeforeReconcile = savedSelection;
        const editor = reconcileActiveEditor();
        if (!editor) {
            return;
        }
        const selection = selectionBeforeReconcile ?? captureEditorSelection(editor.textArea);
        closeOpenMenus();
        restoreEditorSelection(editor.textArea, selection);
        const valueBeforeEdit = editor.textArea.value;
        editor.commandRegistry.executeCommand(commandId, { textArea: editor.textArea });
        focusElementWithoutScrolling(editor.textArea);
        savedSelection = captureEditorSelection(editor.textArea);
        dispatchChangeEventIfRequired(editor, valueBeforeEdit);
        refreshToolbarState();
    };

    const captureSelectionForActivation = (event: Event): void => {
        const editor = reconcileActiveEditor();
        if (!editor) {
            return;
        }
        if (!savedSelection) {
            savedSelection = captureEditorSelection(editor.textArea);
        }
        event.preventDefault();
        event.stopPropagation();
    };

    const handleFocusIn = (event: FocusEvent): void => {
        if (isToolbarEvent(event)) {
            return;
        }
        lastToolbarFocusTarget = undefined;
        const editor = resolveEditorForEvent(event);
        if (editor) {
            activateEditor(editor);
        } else if (event.target === activeEditor?.textArea) {
            removeToolbar();
        }
    };

    const handleEditorStateEvent = (event: Event): void => {
        if (isToolbarEvent(event)) {
            return;
        }
        if (event.type === "select") {
            const eventDocument = isTextAreaElement(event.target) ? event.target.ownerDocument : initialDocument;
            if (event.target !== getDeepActiveElement(eventDocument)) {
                return;
            }
        }
        const editor = resolveEditorForEvent(event);
        if (editor) {
            if (
                activeEditor?.textArea === editor.textArea &&
                getDeepActiveElement(editor.textArea.ownerDocument) === editor.textArea
            ) {
                savedSelection = captureEditorSelection(editor.textArea);
            }
            activateEditor(editor);
            queueToolbarStateRefresh();
        } else if (event.target === activeEditor?.textArea) {
            removeToolbar();
        }
    };

    const handleSelectionChange = (event: Event): void => {
        if (isToolbarFocused()) {
            return;
        }
        const eventDocument =
            event.currentTarget && (event.currentTarget as Node).nodeType === 9
                ? (event.currentTarget as Document)
                : (activeEditor?.textArea.ownerDocument ?? initialDocument);
        const activeElement = getDeepActiveElement(eventDocument);
        if (!isTextAreaElement(activeElement)) {
            return;
        }
        const editor = options.resolveEditorFromTextArea(activeElement);
        if (editor) {
            if (activeEditor?.textArea === editor.textArea) {
                savedSelection = captureEditorSelection(editor.textArea);
            }
            activateEditor(editor);
        }
    };

    const handleToolbarKeydown = (event: KeyboardEvent): void => {
        reconcileActiveEditor();
        if (event.defaultPrevented || event.isComposing) {
            return;
        }
        if (!isButtonElement(event.target) || !container.contains(event.target)) {
            return;
        }
        const target = event.target;
        const targetPanel = target.closest<HTMLElement>(`.${MENU_PANEL_CLASS}`);
        const isMenuItem = Boolean(targetPanel && container.contains(targetPanel));
        const openPanel = getOpenMenuPanel();
        const handleEvent = (): void => {
            event.preventDefault();
            event.stopPropagation();
        };
        if (event.key === "Tab" && openPanel) {
            closeOpenMenus();
            return;
        }
        if (event.key === "Escape" && openPanel) {
            handleEvent();
            closeOpenMenus(true);
            return;
        }
        if (target === styleTrigger && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
            handleEvent();
            openStyleMenu();
            return;
        }
        if (target === moreTrigger && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
            handleEvent();
            openMoreMenu(event.key === "ArrowDown" ? "first" : "last");
            return;
        }
        if (
            isMenuItem &&
            target.getAttribute("aria-disabled") === "true" &&
            (event.key === "Enter" || event.key === " ")
        ) {
            handleEvent();
            return;
        }
        if (isMenuItem && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
            handleEvent();
            if (targetPanel) {
                moveMenuButtonFocus(targetPanel, target, event.key === "ArrowDown" ? 1 : -1);
            }
            return;
        }
        if (event.key === "Home" || event.key === "End") {
            handleEvent();
            const buttons = isMenuItem
                ? targetPanel
                    ? getNavigableMenuButtons(targetPanel)
                    : []
                : getTopLevelButtons().filter((button) => !button.disabled);
            const button = event.key === "Home" ? buttons[0] : buttons.at(-1);
            if (button) {
                if (!isMenuItem) {
                    setToolbarTabStop(button);
                }
                focusElementWithoutScrolling(button);
            }
            return;
        }
        if (!isMenuItem && (event.key === "ArrowRight" || event.key === "ArrowLeft")) {
            handleEvent();
            moveToolbarButtonFocus(target, event.key === "ArrowRight" ? 1 : -1);
        }
    };

    const getEventButton = (event: Event): HTMLButtonElement | null => {
        const target = event.target;
        if (!isElement(target)) {
            return null;
        }
        const button = target.closest("button");
        return isButtonElement(button) && container.contains(button) ? button : null;
    };

    const handleToolbarPointerDown = (event: PointerEvent | MouseEvent): void => {
        pointerToggleFocusTrigger = undefined;
        const button = getEventButton(event);
        if (!button) {
            return;
        }
        captureSelectionForActivation(event);
        const openPanel = getOpenMenuPanel();
        const activeElement = getDeepActiveElement(activeEditor?.textArea.ownerDocument ?? container.ownerDocument);
        if (
            button === getOpenMenuTrigger() &&
            openPanel &&
            isNode(activeElement) &&
            openPanel.contains(activeElement)
        ) {
            pointerToggleFocusTrigger = button;
        }
    };

    const isPrimaryPointerActivation = (event: Event): boolean => {
        if ("isPrimary" in event && event.isPrimary === false) {
            return false;
        }
        return !("button" in event && typeof event.button === "number" && event.button !== 0);
    };

    const shouldDeferToDeeperOutsidePointerRoot = (event: Event, isTargetFallback: boolean): boolean => {
        if (!isTargetFallback || !isNode(event.target)) {
            return false;
        }
        for (const root of outsidePointerRoots) {
            if (isShadowRoot(root) && root.host === event.target) {
                return true;
            }
        }
        return false;
    };

    const getEventOwnerDocument = (event: Event): Document =>
        isNode(event.target) ? (event.target.ownerDocument ?? initialDocument) : initialDocument;

    const queuePostPointerReconciliation = (ownerDocument: Document): void => {
        queueMicrotask(() => {
            if (isDisposed) {
                return;
            }
            const activeElement = getDeepActiveElement(ownerDocument);
            if (!isTextAreaElement(activeElement)) {
                return;
            }
            const editor = options.resolveEditorFromTextArea(activeElement);
            if (editor) {
                activateEditor(editor);
            }
        });
    };

    const dismissOpenMenuForOutsidePointer = (event: Event, panel: HTMLElement): void => {
        const activeElement = getDeepActiveElement(panel.ownerDocument);
        const focusedMenuElement =
            isFocusableElement(activeElement) && panel.contains(activeElement) ? activeElement : undefined;
        lastToolbarFocusTarget = undefined;
        closeOpenMenus();
        focusedMenuElement?.blur();
        queuePostPointerReconciliation(getEventOwnerDocument(event));
    };

    function handleOutsidePointerDown(event: Event): void {
        const { isTargetFallback, path } = resolveEventPath(event);
        deferredOutsidePointerDismissals.delete(event);
        const openPanel = getOpenMenuPanel();
        const openTrigger = getOpenMenuTrigger();
        if (!isPrimaryPointerActivation(event) || !openPanel) {
            return;
        }
        if (shouldDeferToDeeperOutsidePointerRoot(event, isTargetFallback)) {
            const deferredPanel = openPanel;
            const deferral = {};
            deferredOutsidePointerDismissals.set(event, deferral);
            void Promise.resolve().then(() => {
                if (
                    deferredOutsidePointerDismissals.get(event) !== deferral ||
                    getOpenMenuPanel() !== deferredPanel ||
                    deferredPanel.hidden
                ) {
                    return;
                }
                deferredOutsidePointerDismissals.delete(event);
                dismissOpenMenuForOutsidePointer(event, deferredPanel);
            });
            return;
        }
        if (
            isEventWithinElement(event, openPanel, path) ||
            (openTrigger && isEventWithinElement(event, openTrigger, path))
        ) {
            return;
        }
        dismissOpenMenuForOutsidePointer(event, openPanel);
    }

    const handleToolbarClick = (event: MouseEvent): void => {
        if (event.defaultPrevented) {
            pointerToggleFocusTrigger = undefined;
            return;
        }
        const button = getEventButton(event);
        const shouldRestorePointerToggleFocus = button === pointerToggleFocusTrigger;
        pointerToggleFocusTrigger = undefined;
        if (!button) {
            return;
        }
        event.stopPropagation();
        if (button.getAttribute("aria-disabled") === "true") {
            event.preventDefault();
            return;
        }
        if (button === styleTrigger) {
            if (!reconcileActiveEditor()) {
                return;
            }
            if (stylePanel?.hidden) {
                openStyleMenu();
            } else {
                closeOpenMenus(shouldRestorePointerToggleFocus);
            }
            return;
        }
        if (button === moreTrigger) {
            if (!reconcileActiveEditor()) {
                return;
            }
            if (morePanel?.hidden) {
                openMoreMenu(event.detail === 0 ? "first" : undefined);
            } else {
                closeOpenMenus(shouldRestorePointerToggleFocus);
            }
            return;
        }
        const commandId = button.dataset.commandId;
        if (commandId) {
            executeToolbarCommand(commandId);
        }
    };

    const handleToolbarFocusIn = (event: FocusEvent): void => {
        if (!reconcileActiveEditor()) {
            return;
        }
        if (isButtonElement(event.target) && getTopLevelButtons().includes(event.target)) {
            setToolbarTabStop(event.target);
        }
        lastToolbarFocusTarget = captureToolbarFocusTarget();
    };

    const handleDocumentKeydown = (event: KeyboardEvent): void => {
        if (isToolbarEvent(event)) {
            return;
        }
        const isToolbarShortcut =
            event.key === "F10" && event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey;
        if (!isToolbarShortcut || event.defaultPrevented || event.isComposing) {
            handleEditorStateEvent(event);
            return;
        }
        const editor = resolveEditorForEvent(event);
        if (!editor) {
            return;
        }
        activateEditor(editor);
        savedSelection = captureEditorSelection(editor.textArea);
        const firstButton = getTopLevelButtons().find((button) => !button.disabled);
        if (firstButton) {
            event.preventDefault();
            event.stopImmediatePropagation();
            setToolbarTabStop(firstButton);
            focusElementWithoutScrolling(firstButton);
        }
    };

    const handleMutation = (records: readonly MutationRecord[]): void => {
        if (isDisposed) {
            return;
        }
        const textArea = activeEditor?.textArea;
        const isRelevant = records.some((record) => {
            if (record.type === "childList") {
                return !isNode(record.target) || !container.contains(record.target);
            }
            if (record.type !== "attributes") {
                return false;
            }
            if (record.target === textArea) {
                return true;
            }
            return record.attributeName === "id" && !container.contains(record.target);
        });
        if (isRelevant) {
            reconcileActiveEditor();
        }
    };

    const handleSettingsRefresh = (): void => {
        const openMenuName = getOpenMenuName();
        const openPanel = getOpenMenuPanel();
        const activeElement = getDeepActiveElement(activeEditor?.textArea.ownerDocument ?? initialDocument);
        const shouldRestoreTriggerFocus =
            openMenuName !== undefined &&
            openPanel !== undefined &&
            isNode(activeElement) &&
            openPanel.contains(activeElement);
        if (openMenuName) {
            closeOpenMenus();
        }
        const editor = reconcileActiveEditor();
        if (editor && shouldRestoreTriggerFocus && openMenuName) {
            const trigger = getMenuTriggerByName(openMenuName);
            if (trigger && !trigger.disabled) {
                setToolbarTabStop(trigger);
                focusElementWithoutScrolling(trigger);
            }
        }
    };

    const unsubscribeKeydown = options.subscribeKeydown
        ? options.subscribeKeydown(handleDocumentKeydown)
        : () => undefined;

    const addActiveDocumentEventListeners = (ownerDocument: Document): void => {
        const currentMode = documentListenerModes.get(ownerDocument);
        if (!currentMode) {
            ownerDocument.addEventListener("focusin", handleFocusIn);
        }
        if (currentMode !== "active") {
            ownerDocument.addEventListener("selectionchange", handleSelectionChange);
            ownerDocument.addEventListener("input", handleEditorStateEvent);
            ownerDocument.addEventListener("select", handleEditorStateEvent);
            ownerDocument.addEventListener("keyup", handleEditorStateEvent);
            if (!options.subscribeKeydown || ownerDocument !== initialDocument) {
                ownerDocument.addEventListener("keydown", handleDocumentKeydown);
            }
        }
        documentListenerModes.set(ownerDocument, "active");
    };

    const retainDocumentDiscoveryListener = (ownerDocument: Document): void => {
        const currentMode = documentListenerModes.get(ownerDocument);
        if (!currentMode) {
            ownerDocument.addEventListener("focusin", handleFocusIn);
        } else if (currentMode === "active") {
            ownerDocument.removeEventListener("selectionchange", handleSelectionChange);
            ownerDocument.removeEventListener("input", handleEditorStateEvent);
            ownerDocument.removeEventListener("select", handleEditorStateEvent);
            ownerDocument.removeEventListener("keyup", handleEditorStateEvent);
            if (!options.subscribeKeydown || ownerDocument !== initialDocument) {
                ownerDocument.removeEventListener("keydown", handleDocumentKeydown);
            }
        }
        documentListenerModes.set(ownerDocument, "discovery");
    };

    const removeDocumentEventListeners = (ownerDocument: Document): void => {
        const currentMode = documentListenerModes.get(ownerDocument);
        if (!currentMode) {
            return;
        }
        documentListenerModes.delete(ownerDocument);
        ownerDocument.removeEventListener("focusin", handleFocusIn);
        if (currentMode === "active") {
            ownerDocument.removeEventListener("selectionchange", handleSelectionChange);
            ownerDocument.removeEventListener("input", handleEditorStateEvent);
            ownerDocument.removeEventListener("select", handleEditorStateEvent);
            ownerDocument.removeEventListener("keyup", handleEditorStateEvent);
            if (!options.subscribeKeydown || ownerDocument !== initialDocument) {
                ownerDocument.removeEventListener("keydown", handleDocumentKeydown);
            }
        }
    };

    const syncDocumentEventListeners = (activeDocument?: Document): void => {
        if (activeDocument) {
            retainedDiscoveryDocument = activeDocument;
        }
        const nextDocument = isDisposed ? undefined : (activeDocument ?? retainedDiscoveryDocument);
        for (const ownerDocument of documentListenerModes.keys()) {
            if (ownerDocument !== nextDocument) {
                removeDocumentEventListeners(ownerDocument);
            }
        }
        if (nextDocument) {
            if (activeDocument) {
                addActiveDocumentEventListeners(nextDocument);
            } else {
                retainDocumentDiscoveryListener(nextDocument);
            }
        }
    };

    observer = new MutationObserver(handleMutation);
    syncDocumentEventListeners();
    container.addEventListener("pointerdown", handleToolbarPointerDown);
    container.addEventListener("mousedown", handleToolbarPointerDown);
    container.addEventListener("click", handleToolbarClick);
    container.addEventListener("keydown", handleToolbarKeydown);
    container.addEventListener("focusin", handleToolbarFocusIn);
    const unsubscribeSettings = options.subscribeSettings?.(handleSettingsRefresh);

    return () => {
        isDisposed = true;
        observer?.disconnect();
        unsubscribeSettings?.();
        syncDocumentEventListeners();
        unsubscribeKeydown();
        container.removeEventListener("pointerdown", handleToolbarPointerDown);
        container.removeEventListener("mousedown", handleToolbarPointerDown);
        container.removeEventListener("click", handleToolbarClick);
        container.removeEventListener("keydown", handleToolbarKeydown);
        container.removeEventListener("focusin", handleToolbarFocusIn);
        removeToolbar();
    };
};
