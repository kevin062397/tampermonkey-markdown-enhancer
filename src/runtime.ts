import { attachEditorEventRouter } from "./event-router";
import { isSupportedEditor } from "./targeting";

export const initializeMarkdownEnhancer = (): (() => void) => attachEditorEventRouter(isSupportedEditor);
