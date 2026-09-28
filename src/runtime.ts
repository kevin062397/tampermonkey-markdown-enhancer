import { createCommandRegistry, type EditorCommand } from "./command-registry";
import { attachEditorEventRouter } from "./event-router";
import { isSupportedEditor } from "./targeting";

export const initializeMarkdownEnhancer = (additionalCommands: readonly EditorCommand[] = []): (() => void) => {
    const commandRegistry = createCommandRegistry(additionalCommands);
    return attachEditorEventRouter(isSupportedEditor, commandRegistry);
};
