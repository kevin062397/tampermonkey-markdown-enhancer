import type { EditorState } from "./editor-state";

export interface SelectedLineRange {
    readonly replaceStart: number;
    readonly replaceEnd: number;
    readonly lines: readonly string[];
    readonly lineStarts: readonly number[];
}

export const getSelectedLineRange = (state: EditorState): SelectedLineRange => {
    const replaceStart = state.value.slice(0, state.selectionStart).lastIndexOf("\n") + 1;
    const isSelectionEndingAtLineStart =
        state.selectionEnd > state.selectionStart && state.value[state.selectionEnd - 1] === "\n";
    const lineLookupEnd = isSelectionEndingAtLineStart ? state.selectionEnd - 1 : state.selectionEnd;
    const nextLineBreak = state.value.indexOf("\n", lineLookupEnd);
    const replaceEnd = nextLineBreak >= 0 ? nextLineBreak : state.value.length;
    const lines = state.value.slice(replaceStart, replaceEnd).split("\n");
    const lineStarts: number[] = [];
    let lineStart = replaceStart;
    for (const line of lines) {
        lineStarts.push(lineStart);
        lineStart += line.length + 1;
    }
    return { replaceStart, replaceEnd, lines, lineStarts };
};
