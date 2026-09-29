import { createGenericEditorAdapter } from "./adapters/generic-editor-adapter";
import type { EditorAdapter } from "./editor-adapter";

export const createDefaultEditorAdapters = (): readonly EditorAdapter[] => [createGenericEditorAdapter()];
