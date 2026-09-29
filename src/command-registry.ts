import {
    insertMarkdownLinkCommand,
    toggleFencedCodeBlockCommand,
    toggleInlineCodeCommand,
    toggleLinePrefixCommand,
    toggleWrapCommand
} from "./commands";
import type { LinePrefixKind } from "./line-prefixes";

export const EDITOR_COMMAND_IDS = {
    blockquote: "line.blockquote",
    bold: "format.bold",
    codeBlock: "format.codeBlock",
    bulletList: "line.bulletList",
    heading1: "line.heading1",
    heading2: "line.heading2",
    heading3: "line.heading3",
    heading4: "line.heading4",
    heading5: "line.heading5",
    heading6: "line.heading6",
    inlineCode: "format.inlineCode",
    italic: "format.italic",
    link: "insert.link",
    numberedList: "line.numberedList",
    strikethrough: "format.strikethrough",
    taskList: "line.taskList"
} as const;

export interface EditorCommandContext {
    readonly textArea: HTMLTextAreaElement;
}

export interface CommandShortcut {
    readonly key: string;
    readonly isPrimaryModifierRequired: boolean;
}

export interface EditorCommand {
    readonly id: string;
    readonly label: string;
    readonly shortcut?: CommandShortcut;
    readonly isAvailable: (context: EditorCommandContext) => boolean;
    readonly execute: (context: EditorCommandContext) => boolean;
}

export interface EditorCommandRegistry {
    readonly getCommand: (id: string) => EditorCommand | undefined;
    readonly listCommands: () => readonly EditorCommand[];
    readonly findCommandByShortcut: (
        key: string,
        isPrimaryModifierPressed: boolean,
        context: EditorCommandContext
    ) => EditorCommand | undefined;
    readonly executeCommand: (id: string, context: EditorCommandContext) => boolean;
    readonly executeCommandByShortcut: (
        key: string,
        isPrimaryModifierPressed: boolean,
        context: EditorCommandContext
    ) => boolean;
}

const isFormattingAvailable = ({ textArea }: EditorCommandContext): boolean =>
    !textArea.readOnly &&
    !textArea.disabled &&
    /\S/.test(textArea.value.slice(textArea.selectionStart, textArea.selectionEnd));

const isLineFormattingAvailable = ({ textArea }: EditorCommandContext): boolean =>
    !textArea.readOnly && !textArea.disabled;

const isCodeBlockAvailable = ({ textArea }: EditorCommandContext): boolean =>
    !textArea.readOnly && !textArea.disabled && textArea.selectionStart !== textArea.selectionEnd;

const isCommandShortcutMatch = (command: EditorCommand, key: string, isPrimaryModifierPressed: boolean): boolean =>
    command.shortcut?.key.toLowerCase() === key.toLowerCase() &&
    command.shortcut.isPrimaryModifierRequired === isPrimaryModifierPressed;

const createFormattingCommand = (
    id: string,
    label: string,
    wrap: string,
    shortcut?: CommandShortcut
): EditorCommand => ({
    id,
    label,
    shortcut,
    isAvailable: isFormattingAvailable,
    execute: ({ textArea }) => toggleWrapCommand(textArea, wrap)
});

const createLinePrefixCommand = (id: string, label: string, kind: LinePrefixKind): EditorCommand => ({
    id,
    label,
    isAvailable: isLineFormattingAvailable,
    execute: ({ textArea }) => toggleLinePrefixCommand(textArea, kind)
});

const createLinePrefixCommands = (): readonly EditorCommand[] => [
    createLinePrefixCommand(EDITOR_COMMAND_IDS.heading1, "Heading 1", "heading1"),
    createLinePrefixCommand(EDITOR_COMMAND_IDS.heading2, "Heading 2", "heading2"),
    createLinePrefixCommand(EDITOR_COMMAND_IDS.heading3, "Heading 3", "heading3"),
    createLinePrefixCommand(EDITOR_COMMAND_IDS.heading4, "Heading 4", "heading4"),
    createLinePrefixCommand(EDITOR_COMMAND_IDS.heading5, "Heading 5", "heading5"),
    createLinePrefixCommand(EDITOR_COMMAND_IDS.heading6, "Heading 6", "heading6"),
    createLinePrefixCommand(EDITOR_COMMAND_IDS.blockquote, "Blockquote", "blockquote"),
    createLinePrefixCommand(EDITOR_COMMAND_IDS.bulletList, "Bullet list", "bulletList"),
    createLinePrefixCommand(EDITOR_COMMAND_IDS.numberedList, "Numbered list", "numberedList"),
    createLinePrefixCommand(EDITOR_COMMAND_IDS.taskList, "Task list", "taskList")
];

const createCoreCommands = (): readonly EditorCommand[] => [
    createFormattingCommand(EDITOR_COMMAND_IDS.bold, "Bold", "**", {
        key: "b",
        isPrimaryModifierRequired: true
    }),
    createFormattingCommand(EDITOR_COMMAND_IDS.italic, "Italic", "*", {
        key: "i",
        isPrimaryModifierRequired: true
    }),
    createFormattingCommand(EDITOR_COMMAND_IDS.strikethrough, "Strikethrough", "~~"),
    {
        id: EDITOR_COMMAND_IDS.inlineCode,
        label: "Inline code",
        isAvailable: isFormattingAvailable,
        execute: ({ textArea }) => toggleInlineCodeCommand(textArea)
    },
    {
        id: EDITOR_COMMAND_IDS.codeBlock,
        label: "Code block",
        isAvailable: isCodeBlockAvailable,
        execute: ({ textArea }) => toggleFencedCodeBlockCommand(textArea)
    },
    {
        id: EDITOR_COMMAND_IDS.link,
        label: "Link",
        shortcut: { key: "k", isPrimaryModifierRequired: true },
        isAvailable: isFormattingAvailable,
        execute: ({ textArea }) => insertMarkdownLinkCommand(textArea)
    },
    ...createLinePrefixCommands()
];

export const createCommandRegistry = (additionalCommands: readonly EditorCommand[] = []): EditorCommandRegistry => {
    const commands = [...additionalCommands, ...createCoreCommands()];
    const commandsById = new Map<string, EditorCommand>();
    for (const command of commands) {
        if (commandsById.has(command.id)) {
            throw new Error(`Duplicate command ID: ${command.id}`);
        }
        commandsById.set(command.id, command);
    }

    return {
        getCommand: (id) => commandsById.get(id),
        listCommands: () => commands,
        findCommandByShortcut: (key, isPrimaryModifierPressed, context) =>
            commands.find(
                (command) =>
                    isCommandShortcutMatch(command, key, isPrimaryModifierPressed) && command.isAvailable(context)
            ),
        executeCommand: (id, context) => {
            const command = commandsById.get(id);
            if (!command?.isAvailable(context)) {
                return false;
            }
            return command.execute(context);
        },
        executeCommandByShortcut: (key, isPrimaryModifierPressed, context) => {
            for (const command of commands) {
                if (
                    isCommandShortcutMatch(command, key, isPrimaryModifierPressed) &&
                    command.isAvailable(context) &&
                    command.execute(context)
                ) {
                    return true;
                }
            }
            return false;
        }
    };
};
