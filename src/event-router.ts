import type { EditorCommandRegistry } from "./command-registry";
import {
    indentCommand,
    insertSpacesCommand,
    outdentCommand,
    pasteMarkdownLinkCommand,
    wrapSelectionCommand
} from "./commands";

interface WrapCharacters {
    readonly leading: string;
    readonly trailing: string;
    readonly isSelectionRequired: boolean;
}

export type EditorTargetPredicate = (target: EventTarget | null) => target is HTMLTextAreaElement;

const WRAP_CHARACTERS: Record<string, WrapCharacters> = {
    "(": { leading: "(", trailing: ")", isSelectionRequired: false },
    "[": { leading: "[", trailing: "]", isSelectionRequired: false },
    "{": { leading: "{", trailing: "}", isSelectionRequired: false },
    "<": { leading: "<", trailing: ">", isSelectionRequired: false },
    '"': { leading: '"', trailing: '"', isSelectionRequired: true },
    "'": { leading: "'", trailing: "'", isSelectionRequired: true },
    "`": { leading: "`", trailing: "`", isSelectionRequired: true },
    _: { leading: "_", trailing: "_", isSelectionRequired: true },
    "*": { leading: "*", trailing: "*", isSelectionRequired: true },
    "~": { leading: "~", trailing: "~", isSelectionRequired: true }
};

const TAB_SIZE = 4;

const isApplePlatform = (): boolean => /Macintosh|Mac OS X|iPhone|iPad|iPod/i.test(navigator.userAgent);

const isPrimaryModifierPressed = (event: KeyboardEvent): boolean => {
    if (event.altKey || event.shiftKey) {
        return false;
    }
    return isApplePlatform() ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
};

const handleEditorKeydown = (
    event: KeyboardEvent,
    textArea: HTMLTextAreaElement,
    commandRegistry: EditorCommandRegistry
): void => {
    const isSelectionPresent = textArea.selectionStart !== textArea.selectionEnd;
    const isPrimaryModifierActive = isPrimaryModifierPressed(event);
    const isModifierKeyAbsent = !event.ctrlKey && !event.metaKey;
    const isShortcutModifierAllowed =
        !event.altKey && !event.shiftKey && (isPrimaryModifierActive || isModifierKeyAbsent);
    const isEditingModifierAllowed = !event.altKey && !event.ctrlKey && !event.metaKey;
    const context = { textArea };
    if (
        isShortcutModifierAllowed &&
        commandRegistry.executeCommandByShortcut(event.key, isPrimaryModifierActive, context)
    ) {
        event.preventDefault();
        return;
    }

    const wrapCharacters = WRAP_CHARACTERS[event.key];
    if (wrapCharacters && isEditingModifierAllowed && (isSelectionPresent || !wrapCharacters.isSelectionRequired)) {
        event.preventDefault();
        wrapSelectionCommand(textArea, wrapCharacters.leading, wrapCharacters.trailing);
    }

    if (event.key === "Tab" && !event.shiftKey && isEditingModifierAllowed) {
        event.preventDefault();
        if (isSelectionPresent) {
            indentCommand(textArea, TAB_SIZE);
        } else {
            insertSpacesCommand(textArea, TAB_SIZE);
        }
    }

    if (event.key === "Tab" && event.shiftKey && isEditingModifierAllowed) {
        event.preventDefault();
        outdentCommand(textArea, TAB_SIZE);
    }
};

const handleEditorPaste = (event: ClipboardEvent, textArea: HTMLTextAreaElement): void => {
    if (!event.clipboardData) {
        return;
    }

    if (pasteMarkdownLinkCommand(textArea, event.clipboardData.getData("text"))) {
        event.preventDefault();
    }
};

export const attachEditorEventRouter = (
    isSupportedEditor: EditorTargetPredicate,
    commandRegistry: EditorCommandRegistry
): (() => void) => {
    const handleKeydown = (event: KeyboardEvent): void => {
        if (isSupportedEditor(event.target)) {
            handleEditorKeydown(event, event.target, commandRegistry);
        }
    };
    const handlePaste = (event: ClipboardEvent): void => {
        if (isSupportedEditor(event.target)) {
            handleEditorPaste(event, event.target);
        }
    };

    document.addEventListener("keydown", handleKeydown, true);
    document.addEventListener("paste", handlePaste, true);

    return () => {
        document.removeEventListener("keydown", handleKeydown, true);
        document.removeEventListener("paste", handlePaste, true);
    };
};
