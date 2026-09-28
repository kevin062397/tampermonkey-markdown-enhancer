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

export const indentSelectedLines = (state: EditorState, tabSize: number): EditOperation => {
    const { selectionStart: start, selectionEnd: end, value } = state;
    const selectionStartLine = value.slice(0, start).lastIndexOf("\n") + 1;
    const nextLineBreak = value.indexOf("\n", end);
    const selectionEndLine = nextLineBreak >= 0 ? nextLineBreak : value.length;
    const selectedLines = value.slice(selectionStartLine, selectionEndLine).split("\n");
    const text = selectedLines.map((line) => " ".repeat(tabSize) + line).join("\n");
    const addedCharacters = tabSize * selectedLines.length;
    return createEdit(state, selectionStartLine, selectionEndLine, text, start + tabSize, end + addedCharacters);
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
    const { selectionStart: start, selectionEnd: end, value } = state;
    const selectionStartLine = value.slice(0, start).lastIndexOf("\n") + 1;
    const nextLineBreak = value.indexOf("\n", end);
    const selectionEndLine = nextLineBreak >= 0 ? nextLineBreak : value.length;
    const selectedLines = value.slice(selectionStartLine, selectionEndLine).split("\n");
    const indentation = " ".repeat(tabSize);
    const outdentedLines = selectedLines.map((line) =>
        line.startsWith(indentation) ? line.slice(tabSize) : line.replace(/^ +/, "")
    );

    let removedCharacters = 0;
    let removedFromFirstLine = 0;
    selectedLines.forEach((line, index) => {
        const removed = line.length - outdentedLines[index].length;
        removedCharacters += removed;
        if (index === 0) {
            removedFromFirstLine = removed;
        }
    });

    return createEdit(
        state,
        selectionStartLine,
        selectionEndLine,
        outdentedLines.join("\n"),
        Math.max(start - removedFromFirstLine, selectionStartLine),
        Math.max(end - removedCharacters, selectionStartLine)
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
