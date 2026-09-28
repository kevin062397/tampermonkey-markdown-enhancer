export type EditorSelectionDirection = "forward" | "backward" | "none";

export interface EditorState {
    readonly value: string;
    readonly selectionStart: number;
    readonly selectionEnd: number;
    readonly selectionDirection: EditorSelectionDirection;
}

export interface EditOperation {
    readonly replaceStart: number;
    readonly replaceEnd: number;
    readonly text: string;
    readonly selectionStart: number;
    readonly selectionEnd: number;
    readonly selectionDirection: EditorSelectionDirection;
}

export type EditorTransform = (state: EditorState) => EditOperation | null;

export const readEditorState = (textArea: HTMLTextAreaElement): EditorState => ({
    value: textArea.value,
    selectionStart: textArea.selectionStart,
    selectionEnd: textArea.selectionEnd,
    selectionDirection: textArea.selectionDirection ?? "none"
});
