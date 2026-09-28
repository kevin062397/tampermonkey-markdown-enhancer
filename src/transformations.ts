import type { EditOperation, EditorSelectionDirection, EditorState } from "./editor-state";

const createEdit = (
    state: EditorState,
    replaceStart: number,
    replaceEnd: number,
    text: string,
    selectionStart: number,
    selectionEnd: number,
    selectionDirection: EditorSelectionDirection = state.selectionDirection
): EditOperation => ({
    replaceStart,
    replaceEnd,
    text,
    selectionStart,
    selectionEnd,
    selectionDirection
});

const isWrappedWith = (value: string, start: number, end: number, pattern: string): boolean => {
    const before = value.slice(start - pattern.length, start);
    const after = value.slice(end, end + pattern.length);
    return before === pattern && after === pattern;
};

const handleMarkdownToggle = (state: EditorState, wrap: "*" | "**"): EditOperation | null => {
    const { selectionStart: start, selectionEnd: end, value } = state;
    const selectedText = value.slice(start, end);

    if (isWrappedWith(value, start, end, "***")) {
        const newWrap = wrap === "*" ? "**" : "*";
        const newStart = start + (wrap === "*" ? -1 : -2);
        return createEdit(
            state,
            start - 3,
            end + 3,
            newWrap + selectedText + newWrap,
            newStart,
            newStart + selectedText.length
        );
    }

    if (isWrappedWith(value, start, end, wrap)) {
        if (wrap === "*" && (value.slice(start - 2, start) === "**" || value.slice(end, end + 2) === "**")) {
            return null;
        }
        const newStart = start - wrap.length;
        return createEdit(
            state,
            start - wrap.length,
            end + wrap.length,
            selectedText,
            newStart,
            newStart + selectedText.length
        );
    }

    const otherWrap = wrap === "*" ? "**" : "*";
    if (isWrappedWith(value, start, end, otherWrap)) {
        const replacementStart = start - otherWrap.length;
        const newStart = replacementStart + 3;
        return createEdit(
            state,
            replacementStart,
            end + otherWrap.length,
            `***${selectedText}***`,
            newStart,
            newStart + selectedText.length
        );
    }

    if (selectedText.startsWith(wrap) && selectedText.endsWith(wrap) && selectedText.length >= wrap.length * 2) {
        const unwrapped = selectedText.slice(wrap.length, -wrap.length);
        return createEdit(state, start, end, unwrapped, start, start + unwrapped.length);
    }

    return null;
};

const handleGenericToggle = (state: EditorState, wrap: string): EditOperation | null => {
    const { selectionStart: start, selectionEnd: end, value } = state;
    const selectedText = value.slice(start, end);

    if (isWrappedWith(value, start, end, wrap)) {
        const newStart = start - wrap.length;
        return createEdit(state, newStart, end + wrap.length, selectedText, newStart, newStart + selectedText.length);
    }

    if (selectedText.startsWith(wrap) && selectedText.endsWith(wrap) && selectedText.length >= wrap.length * 2) {
        const unwrapped = selectedText.slice(wrap.length, -wrap.length);
        return createEdit(state, start, end, unwrapped, start, start + unwrapped.length);
    }

    return null;
};

export const wrapSelection = (state: EditorState, leading: string, trailing: string): EditOperation => {
    const selectedText = state.value.slice(state.selectionStart, state.selectionEnd);
    const selectionStart = state.selectionStart + leading.length;
    return createEdit(
        state,
        state.selectionStart,
        state.selectionEnd,
        leading + selectedText + trailing,
        selectionStart,
        selectionStart + selectedText.length
    );
};

export const toggleWrap = (state: EditorState, wrap: string): EditOperation => {
    const specialEdit =
        wrap === "*" || wrap === "**" ? handleMarkdownToggle(state, wrap) : handleGenericToggle(state, wrap);
    if (specialEdit) {
        return specialEdit;
    }

    const selectedText = state.value.slice(state.selectionStart, state.selectionEnd);
    const selectionStart = state.selectionStart + wrap.length;
    return createEdit(
        state,
        state.selectionStart,
        state.selectionEnd,
        wrap + selectedText + wrap,
        selectionStart,
        selectionStart + selectedText.length
    );
};

interface SelectedLineRange {
    readonly replaceStart: number;
    readonly replaceEnd: number;
    readonly lines: readonly string[];
    readonly lineStarts: readonly number[];
}

const getSelectedLineRange = (state: EditorState): SelectedLineRange => {
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

const mapPositionAfterIndent = (position: number, lineStarts: readonly number[], tabSize: number): number => {
    const addedLineCount = lineStarts.filter((lineStart) => lineStart <= position).length;
    return position + addedLineCount * tabSize;
};

const countLeadingSpaces = (line: string, tabSize: number): number =>
    Math.min(line.match(/^ */)?.[0].length ?? 0, tabSize);

const mapPositionAfterOutdent = (
    position: number,
    lineStarts: readonly number[],
    removedSpacesByLine: readonly number[]
): number => {
    let removedSpacesBeforePosition = 0;
    for (const [index, lineStart] of lineStarts.entries()) {
        const removedSpaces = removedSpacesByLine[index];
        if (position < lineStart) {
            break;
        }
        if (position <= lineStart + removedSpaces) {
            return lineStart - removedSpacesBeforePosition;
        }
        removedSpacesBeforePosition += removedSpaces;
    }
    return position - removedSpacesBeforePosition;
};

export const indentSelectedLines = (state: EditorState, tabSize: number): EditOperation => {
    const range = getSelectedLineRange(state);
    const text = range.lines.map((line) => " ".repeat(tabSize) + line).join("\n");
    return createEdit(
        state,
        range.replaceStart,
        range.replaceEnd,
        text,
        mapPositionAfterIndent(state.selectionStart, range.lineStarts, tabSize),
        mapPositionAfterIndent(state.selectionEnd, range.lineStarts, tabSize)
    );
};

export const insertSpaces = (state: EditorState, tabSize: number): EditOperation => {
    const currentLine = state.value.slice(0, state.selectionStart).split("\n").pop() ?? "";
    const spacesToInsert = tabSize - (currentLine.length % tabSize);
    const cursor = state.selectionStart + spacesToInsert;
    return createEdit(
        state,
        state.selectionStart,
        state.selectionEnd,
        " ".repeat(spacesToInsert),
        cursor,
        cursor,
        "none"
    );
};

export const outdentSelectedLines = (state: EditorState, tabSize: number): EditOperation => {
    const range = getSelectedLineRange(state);
    const removedSpacesByLine = range.lines.map((line) => countLeadingSpaces(line, tabSize));
    const text = range.lines.map((line, index) => line.slice(removedSpacesByLine[index])).join("\n");
    return createEdit(
        state,
        range.replaceStart,
        range.replaceEnd,
        text,
        mapPositionAfterOutdent(state.selectionStart, range.lineStarts, removedSpacesByLine),
        mapPositionAfterOutdent(state.selectionEnd, range.lineStarts, removedSpacesByLine)
    );
};

export const isHyperlink = (text: string): boolean => /^(https?:\/\/|ftp:\/\/|mailto:)[^\s]+$/i.test(text.trim());

export const createMarkdownLink = (state: EditorState, pasteText: string): EditOperation | null => {
    if (state.selectionStart === state.selectionEnd || !isHyperlink(pasteText)) {
        return null;
    }

    const selectedText = state.value.slice(state.selectionStart, state.selectionEnd);
    const text = `[${selectedText}](${pasteText.trim()})`;
    const cursor = state.selectionStart + text.length;
    return createEdit(state, state.selectionStart, state.selectionEnd, text, cursor, cursor, "none");
};
