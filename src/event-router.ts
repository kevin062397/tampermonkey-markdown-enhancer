import {
    indentCommand,
    insertSpacesCommand,
    outdentCommand,
    pasteMarkdownLinkCommand,
    toggleWrapCommand,
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

const getOSModifierKey = (): "ctrl" | "meta" => {
    const platform = navigator.platform.toLowerCase();
    return platform.includes("mac") ? "meta" : "ctrl";
};

const handleEditorKeydown = (event: KeyboardEvent, textArea: HTMLTextAreaElement): void => {
    const isSelectionPresent = textArea.selectionStart !== textArea.selectionEnd;
    const osModifierKey = getOSModifierKey();
    const isModifierKey =
        (osModifierKey === "meta" && event.metaKey && !event.ctrlKey) ||
        (osModifierKey === "ctrl" && event.ctrlKey && !event.metaKey);

    if (isModifierKey && event.key.toLowerCase() === "b") {
        event.preventDefault();
        if (isSelectionPresent) {
            toggleWrapCommand(textArea, "**");
        }
        return;
    }

    if (isModifierKey && event.key.toLowerCase() === "i") {
        event.preventDefault();
        if (isSelectionPresent) {
            toggleWrapCommand(textArea, "*");
        }
        return;
    }

    const wrapCharacters = WRAP_CHARACTERS[event.key];
    if (wrapCharacters && (isSelectionPresent || !wrapCharacters.isSelectionRequired)) {
        event.preventDefault();
        wrapSelectionCommand(textArea, wrapCharacters.leading, wrapCharacters.trailing);
    }

    if (event.key === "Tab" && !event.shiftKey) {
        event.preventDefault();
        if (isSelectionPresent) {
            indentCommand(textArea, TAB_SIZE);
        } else {
            insertSpacesCommand(textArea, TAB_SIZE);
        }
    }

    if (event.key === "Tab" && event.shiftKey) {
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

export const attachEditorEventRouter = (isSupportedEditor: EditorTargetPredicate): (() => void) => {
    const handleKeydown = (event: KeyboardEvent): void => {
        if (isSupportedEditor(event.target)) {
            handleEditorKeydown(event, event.target);
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
