import { insertMarkdownLinkCommand, toggleWrapCommand } from "./commands";

export const EDITOR_COMMAND_IDS = {
    bold: "format.bold",
    inlineCode: "format.inlineCode",
    italic: "format.italic",
    link: "insert.link",
    strikethrough: "format.strikethrough"
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
    createFormattingCommand(EDITOR_COMMAND_IDS.inlineCode, "Inline code", "`"),
    {
        id: EDITOR_COMMAND_IDS.link,
        label: "Link",
        shortcut: { key: "k", isPrimaryModifierRequired: true },
        isAvailable: isFormattingAvailable,
        execute: ({ textArea }) => insertMarkdownLinkCommand(textArea)
    }
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
