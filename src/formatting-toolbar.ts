import { EDITOR_COMMAND_IDS, type EditorCommand, type EditorCommandRegistry } from "./command-registry";
import type { EditorToolbarPlacement } from "./editor-adapter";
import { createToolbarCommandIcon, createToolbarMoreIcon, TOOLBAR_ICON_CLASS } from "./formatting-toolbar-icons";

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
type OverflowFocusTarget = "first" | "last" | undefined;

const TOOLBAR_CLASS = "tampermonkey-markdown-enhancer-formatting-toolbar";
const TOOLBAR_DATA_ATTRIBUTE = "data-tampermonkey-markdown-enhancer-formatting-toolbar";
const OVERFLOW_PANEL_CLASS = `${TOOLBAR_CLASS}__overflow-panel`;
const OVERFLOW_WRAPPER_CLASS = `${TOOLBAR_CLASS}__overflow-wrapper`;
const BUTTON_LABEL_CLASS = `${TOOLBAR_CLASS}__label`;

const PRIMARY_COMMANDS: readonly string[] = [
    EDITOR_COMMAND_IDS.bold,
    EDITOR_COMMAND_IDS.italic,
    EDITOR_COMMAND_IDS.strikethrough,
    EDITOR_COMMAND_IDS.inlineCode,
    EDITOR_COMMAND_IDS.link
];

const PRIMARY_COMMAND_IDS = new Set(PRIMARY_COMMANDS);

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
.${TOOLBAR_CLASS} button:hover:not(:disabled) {
    background: #eeeeee !important;
}
.${TOOLBAR_CLASS} button:focus-visible {
    outline: 2px solid #2563eb !important;
    outline-offset: 1px !important;
}
.${TOOLBAR_CLASS} button:disabled {
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
.${TOOLBAR_CLASS} .${BUTTON_LABEL_CLASS} {
    display: inline-block !important;
}
.${OVERFLOW_WRAPPER_CLASS} {
    all: initial !important;
    display: inline-flex !important;
    position: relative !important;
}
.${OVERFLOW_PANEL_CLASS} {
    all: initial !important;
    background: #f7f7f7 !important;
    border: 1px solid #a8a8a8 !important;
    border-radius: 4px !important;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.18) !important;
    display: grid !important;
    gap: 2px !important;
    left: 0 !important;
    max-height: 240px !important;
    min-width: 150px !important;
    overflow: auto !important;
    padding: 3px !important;
    position: absolute !important;
    top: calc(100% + 3px) !important;
    z-index: 2147483647 !important;
}
.${OVERFLOW_PANEL_CLASS}[hidden] {
    display: none !important;
}
.${OVERFLOW_PANEL_CLASS} button {
    font-weight: 600 !important;
    justify-content: flex-start !important;
    width: 100% !important;
}
@media (forced-colors: active) {
    .${TOOLBAR_CLASS},
    .${OVERFLOW_PANEL_CLASS} {
        background: Canvas !important;
        border-color: CanvasText !important;
    }
    .${OVERFLOW_PANEL_CLASS} {
        box-shadow: none !important;
    }
    .${TOOLBAR_CLASS} button {
        background: ButtonFace !important;
        border-color: ButtonText !important;
        color: ButtonText !important;
        forced-color-adjust: auto !important;
    }
    .${TOOLBAR_CLASS} button:hover:not(:disabled) {
        background: Highlight !important;
        color: HighlightText !important;
    }
    .${TOOLBAR_CLASS} button:focus-visible {
        outline-color: Highlight !important;
    }
    .${TOOLBAR_CLASS} button:disabled {
        color: GrayText !important;
        opacity: 1 !important;
    }
}
`;

let toolbarSequence = 0;

const getEditorRoot = (textArea: HTMLTextAreaElement): ToolbarRoot => {
    const root = textArea.getRootNode();
    return root instanceof ShadowRoot ? root : document;
};

const getDeepActiveElement = (): Element | null => {
    let activeElement = document.activeElement;
    while (activeElement?.shadowRoot?.activeElement) {
        activeElement = activeElement.shadowRoot.activeElement;
    }
    return activeElement;
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

const getEnabledButtons = (root: ParentNode): HTMLButtonElement[] =>
    Array.from(root.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")).filter(
        (button) => !button.closest<HTMLElement>(`.${OVERFLOW_PANEL_CLASS}`)?.hidden
    );

const moveButtonFocus = (buttons: readonly HTMLButtonElement[], current: HTMLButtonElement, offset: number): void => {
    const currentIndex = buttons.indexOf(current);
    if (currentIndex < 0 || buttons.length === 0) {
        return;
    }
    const nextIndex = (currentIndex + offset + buttons.length) % buttons.length;
    focusElementWithoutScrolling(buttons[nextIndex]);
};

export const attachFormattingToolbar = (options: FormattingToolbarOptions): (() => void) => {
    const container = document.createElement("div");
    container.className = TOOLBAR_CLASS;
    container.setAttribute(TOOLBAR_DATA_ATTRIBUTE, "");
    container.setAttribute("role", "toolbar");
    container.setAttribute("aria-label", "Markdown formatting");

    const style = createToolbarStyle();
    let activeEditor: FormattingToolbarEditor | undefined;
    let savedSelection: EditorSelection | undefined;
    let overflowPanel: HTMLElement | undefined;
    let overflowTrigger: HTMLButtonElement | undefined;
    let renderedCommandPresentation = "";
    let isDisposed = false;
    let isRefreshQueued = false;
    let observer: MutationObserver | undefined;
    const observedShadowRoots = new WeakSet<ShadowRoot>();
    const outsidePointerRoots = new Set<ToolbarRoot>();
    const deferredOutsidePointerDismissals = new WeakMap<Event, object>();

    let placedToolbarAncestors: readonly Node[] = [];

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
        return event.target instanceof Node && element.contains(event.target);
    };

    const isToolbarEvent = (event: Event): boolean => isEventWithinElement(event, container);

    const getEnclosingToolbarRoots = (): ToolbarRoot[] => {
        const roots: ToolbarRoot[] = [];
        let root = container.getRootNode();
        while (root instanceof ShadowRoot) {
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
            current = current.parentNode ?? (current instanceof ShadowRoot ? current.host : null);
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
            if (child instanceof HTMLButtonElement) {
                return [child];
            }
            return Array.from(child.children).filter(
                (element): element is HTMLButtonElement => element instanceof HTMLButtonElement
            );
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

    const createOverflowPanelId = (root: ToolbarRoot): string => {
        let panelId: string;
        do {
            panelId = `tampermonkey-markdown-enhancer-formatting-overflow-${toolbarSequence++}`;
        } while (document.getElementById(panelId) || (root !== document && root.getElementById(panelId)));
        return panelId;
    };

    const getCommandPresentation = (registry: EditorCommandRegistry): string =>
        JSON.stringify(registry.listCommands().map(({ id, label }) => [id, label]));

    const closeOverflow = (shouldFocusTrigger = false): void => {
        removeOutsidePointerDismissal();
        if (!overflowPanel || !overflowTrigger) {
            return;
        }
        overflowPanel.hidden = true;
        overflowTrigger.setAttribute("aria-expanded", "false");
        if (shouldFocusTrigger) {
            setToolbarTabStop(overflowTrigger);
            focusElementWithoutScrolling(overflowTrigger);
        }
    };

    const refreshAvailability = (): void => {
        if (!activeEditor) {
            return;
        }
        const context = { textArea: activeEditor.textArea };
        for (const button of container.querySelectorAll<HTMLButtonElement>("button[data-command-id]")) {
            const command = activeEditor.commandRegistry.getCommand(button.dataset.commandId ?? "");
            button.disabled = !command?.isAvailable(context);
        }
        setToolbarTabStop();
    };

    const queueAvailabilityRefresh = (): void => {
        if (isRefreshQueued || isDisposed) {
            return;
        }
        isRefreshQueued = true;
        queueMicrotask(() => {
            isRefreshQueued = false;
            if (!isDisposed) {
                refreshAvailability();
            }
        });
    };

    const createCommandButton = (command: EditorCommand, isMenuItem: boolean): HTMLButtonElement => {
        const button = document.createElement("button");
        button.type = "button";
        button.dataset.commandId = command.id;
        button.append(createToolbarCommandIcon(command.id));
        button.title = command.label;
        button.setAttribute("aria-label", command.label);
        button.tabIndex = -1;
        if (isMenuItem) {
            const label = document.createElement("span");
            label.className = BUTTON_LABEL_CLASS;
            label.textContent = command.label;
            button.append(label);
            button.setAttribute("role", "menuitem");
        }
        return button;
    };

    const openOverflow = (focusTarget: OverflowFocusTarget = undefined): void => {
        if (!overflowPanel || !overflowTrigger) {
            return;
        }
        overflowPanel.hidden = false;
        overflowTrigger.setAttribute("aria-expanded", "true");
        addOutsidePointerDismissal();
        refreshAvailability();
        if (focusTarget) {
            const commands = getEnabledButtons(overflowPanel);
            const command = focusTarget === "first" ? commands[0] : commands.at(-1);
            if (command) {
                focusElementWithoutScrolling(command);
            }
        }
    };

    const renderCommands = (registry: EditorCommandRegistry, root: ToolbarRoot): void => {
        closeOverflow();
        const commands = registry.listCommands();
        const commandsById = new Map(commands.map((command) => [command.id, command]));
        const elements: Node[] = [style];

        for (const commandId of PRIMARY_COMMANDS) {
            const command = commandsById.get(commandId);
            if (command) {
                elements.push(createCommandButton(command, false));
            }
        }

        const overflowWrapper = document.createElement("span");
        overflowWrapper.className = OVERFLOW_WRAPPER_CLASS;
        const panelId = createOverflowPanelId(root);
        overflowTrigger = document.createElement("button");
        overflowTrigger.type = "button";
        const overflowLabel = document.createElement("span");
        overflowLabel.className = BUTTON_LABEL_CLASS;
        overflowLabel.textContent = "More";
        overflowTrigger.append(createToolbarMoreIcon(), overflowLabel);
        overflowTrigger.title = "More formatting commands";
        overflowTrigger.setAttribute("aria-label", "More formatting commands");
        overflowTrigger.setAttribute("aria-haspopup", "menu");
        overflowTrigger.setAttribute("aria-expanded", "false");
        overflowTrigger.setAttribute("aria-controls", panelId);
        overflowTrigger.tabIndex = -1;

        overflowPanel = document.createElement("div");
        overflowPanel.id = panelId;
        overflowPanel.className = OVERFLOW_PANEL_CLASS;
        overflowPanel.hidden = true;
        overflowPanel.setAttribute("role", "menu");
        overflowPanel.setAttribute("aria-label", "More formatting commands");
        for (const command of commands.filter(({ id }) => !PRIMARY_COMMAND_IDS.has(id))) {
            overflowPanel.append(createCommandButton(command, true));
        }
        overflowWrapper.append(overflowTrigger, overflowPanel);
        elements.push(overflowWrapper);
        container.replaceChildren(...elements);
        renderedCommandPresentation = getCommandPresentation(registry);
        setToolbarTabStop();
    };

    const observeEditorRoot = (editor: FormattingToolbarEditor): void => {
        const root = getEditorRoot(editor.textArea);
        if (root instanceof ShadowRoot && !observedShadowRoots.has(root)) {
            observer?.observe(root, { childList: true, subtree: true });
            observedShadowRoots.add(root);
        }
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
        closeOverflow();
        container.remove();
        placedToolbarAncestors = [];
        activeEditor = undefined;
        savedSelection = undefined;
    };

    const activateEditor = (editor: FormattingToolbarEditor): void => {
        const isSameEditor = activeEditor?.textArea === editor.textArea;
        const commandPresentation = getCommandPresentation(editor.commandRegistry);
        const isCommandPresentationChanged = commandPresentation !== renderedCommandPresentation;
        if (
            !isSameEditor ||
            isCommandPresentationChanged ||
            !isToolbarPlaced(editor) ||
            !areToolbarAncestorsCurrent()
        ) {
            closeOverflow();
        }
        activeEditor = editor;
        savedSelection = captureEditorSelection(editor.textArea);
        observeEditorRoot(editor);
        if (!isSameEditor || isCommandPresentationChanged) {
            renderCommands(editor.commandRegistry, getEditorRoot(editor.textArea));
        }
        placeToolbar(editor);
        refreshAvailability();
    };

    function reconcileActiveEditor(): FormattingToolbarEditor | null {
        const textArea = activeEditor?.textArea;
        if (!textArea || !textArea.isConnected) {
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
        activateEditor(resolvedEditor);
        return resolvedEditor;
    }

    const executeToolbarCommand = (commandId: string): void => {
        const editor = reconcileActiveEditor();
        if (!editor) {
            return;
        }
        const selection = savedSelection ?? captureEditorSelection(editor.textArea);
        closeOverflow();
        restoreEditorSelection(editor.textArea, selection);
        const valueBeforeEdit = editor.textArea.value;
        editor.commandRegistry.executeCommand(commandId, { textArea: editor.textArea });
        focusElementWithoutScrolling(editor.textArea);
        savedSelection = captureEditorSelection(editor.textArea);
        dispatchChangeEventIfRequired(editor, valueBeforeEdit);
        refreshAvailability();
    };

    const captureSelectionForActivation = (event: Event): void => {
        const editor = reconcileActiveEditor();
        if (!editor) {
            return;
        }
        savedSelection = captureEditorSelection(editor.textArea);
        event.preventDefault();
        event.stopPropagation();
    };

    const handleFocusIn = (event: FocusEvent): void => {
        if (isToolbarEvent(event)) {
            return;
        }
        const editor = options.resolveEditor(event);
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
        const editor = options.resolveEditor(event);
        if (editor) {
            if (activeEditor?.textArea !== editor.textArea) {
                activateEditor(editor);
            } else {
                activeEditor = editor;
                savedSelection = captureEditorSelection(editor.textArea);
                const isCommandPresentationChanged =
                    getCommandPresentation(editor.commandRegistry) !== renderedCommandPresentation;
                if (isCommandPresentationChanged || !isToolbarPlaced(editor) || !areToolbarAncestorsCurrent()) {
                    closeOverflow();
                }
                if (isCommandPresentationChanged) {
                    renderCommands(editor.commandRegistry, getEditorRoot(editor.textArea));
                }
                placeToolbar(editor);
                queueAvailabilityRefresh();
            }
        } else if (event.target === activeEditor?.textArea) {
            removeToolbar();
        }
    };

    const handleSelectionChange = (): void => {
        const activeElement = getDeepActiveElement();
        if (!(activeElement instanceof HTMLTextAreaElement)) {
            return;
        }
        const editor = options.resolveEditorFromTextArea(activeElement);
        if (editor) {
            if (activeEditor?.textArea !== editor.textArea) {
                activateEditor(editor);
            } else {
                activeEditor = editor;
                savedSelection = captureEditorSelection(editor.textArea);
                const isCommandPresentationChanged =
                    getCommandPresentation(editor.commandRegistry) !== renderedCommandPresentation;
                if (isCommandPresentationChanged || !isToolbarPlaced(editor) || !areToolbarAncestorsCurrent()) {
                    closeOverflow();
                }
                if (isCommandPresentationChanged) {
                    renderCommands(editor.commandRegistry, getEditorRoot(editor.textArea));
                }
                placeToolbar(editor);
                queueAvailabilityRefresh();
            }
        }
    };

    const handleToolbarKeydown = (event: KeyboardEvent): void => {
        reconcileActiveEditor();
        if (event.defaultPrevented || event.isComposing) {
            return;
        }
        if (!(event.target instanceof HTMLButtonElement) || !container.contains(event.target)) {
            return;
        }
        const target = event.target;
        const isOverflowItem = overflowPanel?.contains(target) ?? false;
        const handleEvent = (): void => {
            event.preventDefault();
            event.stopPropagation();
        };
        if (event.key === "Tab" && overflowPanel && !overflowPanel.hidden) {
            closeOverflow();
            return;
        }
        if (event.key === "Escape" && overflowPanel && !overflowPanel.hidden) {
            handleEvent();
            closeOverflow(true);
            return;
        }
        if (target === overflowTrigger && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
            handleEvent();
            openOverflow(event.key === "ArrowDown" ? "first" : "last");
            return;
        }
        if (isOverflowItem && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
            handleEvent();
            const buttons = overflowPanel ? getEnabledButtons(overflowPanel) : [];
            moveButtonFocus(buttons, target, event.key === "ArrowDown" ? 1 : -1);
            return;
        }
        if (event.key === "Home" || event.key === "End") {
            handleEvent();
            const buttons = isOverflowItem
                ? overflowPanel
                    ? getEnabledButtons(overflowPanel)
                    : []
                : getTopLevelButtons().filter((button) => !button.disabled);
            const button = event.key === "Home" ? buttons[0] : buttons.at(-1);
            if (button) {
                if (!isOverflowItem) {
                    setToolbarTabStop(button);
                }
                focusElementWithoutScrolling(button);
            }
            return;
        }
        if (!isOverflowItem && (event.key === "ArrowRight" || event.key === "ArrowLeft")) {
            handleEvent();
            moveToolbarButtonFocus(target, event.key === "ArrowRight" ? 1 : -1);
        }
    };

    const getEventButton = (event: Event): HTMLButtonElement | null => {
        const target = event.target;
        if (!(target instanceof Element)) {
            return null;
        }
        const button = target.closest("button");
        return button instanceof HTMLButtonElement && container.contains(button) ? button : null;
    };

    const handleToolbarPointerDown = (event: PointerEvent | MouseEvent): void => {
        if (getEventButton(event)) {
            captureSelectionForActivation(event);
        }
    };

    const isPrimaryPointerActivation = (event: Event): boolean => {
        if ("isPrimary" in event && event.isPrimary === false) {
            return false;
        }
        return !("button" in event && typeof event.button === "number" && event.button !== 0);
    };

    const shouldDeferToDeeperOutsidePointerRoot = (event: Event, isTargetFallback: boolean): boolean => {
        if (!isTargetFallback || !(event.target instanceof Node)) {
            return false;
        }
        for (const root of outsidePointerRoots) {
            if (root instanceof ShadowRoot && root.host === event.target) {
                return true;
            }
        }
        return false;
    };

    function handleOutsidePointerDown(event: Event): void {
        const { isTargetFallback, path } = resolveEventPath(event);
        deferredOutsidePointerDismissals.delete(event);
        if (!isPrimaryPointerActivation(event) || !overflowPanel || overflowPanel.hidden) {
            return;
        }
        if (shouldDeferToDeeperOutsidePointerRoot(event, isTargetFallback)) {
            const deferredPanel = overflowPanel;
            const deferral = {};
            deferredOutsidePointerDismissals.set(event, deferral);
            void Promise.resolve().then(() => {
                if (
                    deferredOutsidePointerDismissals.get(event) !== deferral ||
                    overflowPanel !== deferredPanel ||
                    deferredPanel.hidden
                ) {
                    return;
                }
                deferredOutsidePointerDismissals.delete(event);
                closeOverflow();
            });
            return;
        }
        if (
            isEventWithinElement(event, overflowPanel, path) ||
            (overflowTrigger && isEventWithinElement(event, overflowTrigger, path))
        ) {
            return;
        }
        closeOverflow();
    }

    const handleToolbarClick = (event: MouseEvent): void => {
        const button = getEventButton(event);
        if (!button) {
            return;
        }
        event.stopPropagation();
        if (button === overflowTrigger) {
            if (!reconcileActiveEditor()) {
                return;
            }
            if (overflowPanel?.hidden) {
                openOverflow(event.detail === 0 ? "first" : undefined);
            } else {
                closeOverflow();
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
        if (event.target instanceof HTMLButtonElement && getTopLevelButtons().includes(event.target)) {
            setToolbarTabStop(event.target);
        }
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
        const editor = options.resolveEditor(event);
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

    const handleMutation = (): void => {
        if (!isDisposed) {
            reconcileActiveEditor();
        }
    };

    document.addEventListener("focusin", handleFocusIn);
    document.addEventListener("selectionchange", handleSelectionChange);
    document.addEventListener("input", handleEditorStateEvent);
    document.addEventListener("select", handleEditorStateEvent);
    document.addEventListener("keyup", handleEditorStateEvent);
    const unsubscribeKeydown = options.subscribeKeydown
        ? options.subscribeKeydown(handleDocumentKeydown)
        : (() => {
              document.addEventListener("keydown", handleDocumentKeydown);
              return () => document.removeEventListener("keydown", handleDocumentKeydown);
          })();
    observer = new MutationObserver(handleMutation);
    observer.observe(document.documentElement, { childList: true, subtree: true });
    container.addEventListener("pointerdown", handleToolbarPointerDown);
    container.addEventListener("mousedown", handleToolbarPointerDown);
    container.addEventListener("click", handleToolbarClick);
    container.addEventListener("keydown", handleToolbarKeydown);
    container.addEventListener("focusin", handleToolbarFocusIn);
    const unsubscribeSettings = options.subscribeSettings?.(reconcileActiveEditor);

    return () => {
        isDisposed = true;
        observer?.disconnect();
        unsubscribeSettings?.();
        document.removeEventListener("focusin", handleFocusIn);
        document.removeEventListener("selectionchange", handleSelectionChange);
        document.removeEventListener("input", handleEditorStateEvent);
        document.removeEventListener("select", handleEditorStateEvent);
        document.removeEventListener("keyup", handleEditorStateEvent);
        unsubscribeKeydown();
        container.removeEventListener("pointerdown", handleToolbarPointerDown);
        container.removeEventListener("mousedown", handleToolbarPointerDown);
        container.removeEventListener("click", handleToolbarClick);
        container.removeEventListener("keydown", handleToolbarKeydown);
        container.removeEventListener("focusin", handleToolbarFocusIn);
        removeToolbar();
    };
};
