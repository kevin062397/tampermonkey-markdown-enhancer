import type { EditOperation, EditorSelectionDirection, EditorState } from "./editor-state";
import { getSelectedLineRange } from "./line-ranges";
import {
    isCharacterEscaped,
    isClosingPairCharacter,
    isClosingPairMatched,
    isEmptyCharacterPair
} from "./paired-characters";

const createEdit = (
    state: EditorState,
    replaceStart: number,
    replaceEnd: number,
    text: string,
    selectionStart: number,
    selectionEnd: number,
    selectionDirection: EditorSelectionDirection = state.selectionDirection
): EditOperation => ({
    isTextReplacementRequired: true,
    replaceStart,
    replaceEnd,
    text,
    selectionStart,
    selectionEnd,
    selectionDirection
});

interface TextParts {
    readonly leadingWhitespace: string;
    readonly content: string;
    readonly trailingWhitespace: string;
}

const getTextParts = (text: string): TextParts => {
    const leadingWhitespace = text.match(/^\s*/)?.[0] ?? "";
    const trailingWhitespace = text.match(/\s*$/)?.[0] ?? "";
    const contentStart = leadingWhitespace.length;
    const contentEnd = Math.max(contentStart, text.length - trailingWhitespace.length);
    return {
        leadingWhitespace,
        content: text.slice(contentStart, contentEnd),
        trailingWhitespace: text.slice(contentEnd)
    };
};

const getNonWhitespaceSelection = (state: EditorState): EditorState | null => {
    const selectedText = state.value.slice(state.selectionStart, state.selectionEnd);
    const parts = getTextParts(selectedText);
    if (!parts.content) {
        return null;
    }
    return {
        ...state,
        selectionStart: state.selectionStart + parts.leadingWhitespace.length,
        selectionEnd: state.selectionEnd - parts.trailingWhitespace.length
    };
};

const createFormattingEdit = (
    state: EditorState,
    replaceStart: number,
    replaceEnd: number,
    parts: TextParts,
    marker: string
): EditOperation => {
    const text = parts.leadingWhitespace + marker + parts.content + marker + parts.trailingWhitespace;
    const selectionStart = replaceStart + parts.leadingWhitespace.length + marker.length;
    return createEdit(state, replaceStart, replaceEnd, text, selectionStart, selectionStart + parts.content.length);
};

const countMatchingCharactersBefore = (value: string, index: number, character: string): number => {
    let count = 0;
    while (index - count - 1 >= 0 && value[index - count - 1] === character) {
        count += 1;
    }
    return count;
};

const countMatchingCharactersAfter = (value: string, index: number, character: string): number => {
    let count = 0;
    while (index + count < value.length && value[index + count] === character) {
        count += 1;
    }
    return count;
};

const countExternalMarkerDepth = (state: EditorState, character: string): number =>
    Math.min(
        countMatchingCharactersBefore(state.value, state.selectionStart, character),
        countMatchingCharactersAfter(state.value, state.selectionEnd, character)
    );

const countIncludedMarkerDepth = (text: string, character: string): number => {
    let leadingCount = 0;
    while (leadingCount < text.length && text[leadingCount] === character) {
        leadingCount += 1;
    }
    let trailingCount = 0;
    while (trailingCount < text.length && text[text.length - trailingCount - 1] === character) {
        trailingCount += 1;
    }
    return Math.min(leadingCount, trailingCount);
};

const getCombinedTextParts = (outerParts: TextParts, includedMarkerDepth: number): TextParts => {
    const innerText = includedMarkerDepth
        ? outerParts.content.slice(includedMarkerDepth, -includedMarkerDepth)
        : outerParts.content;
    const innerParts = getTextParts(innerText);
    return {
        leadingWhitespace: outerParts.leadingWhitespace + innerParts.leadingWhitespace,
        content: innerParts.content,
        trailingWhitespace: innerParts.trailingWhitespace + outerParts.trailingWhitespace
    };
};

const getToggledAsteriskDepth = (currentDepth: number, targetDepth: 1 | 2): number => {
    if (targetDepth === 1) {
        return currentDepth % 2 === 1 ? currentDepth - 1 : currentDepth + 1;
    }
    return currentDepth >= 2 ? currentDepth - 2 : currentDepth + 2;
};

const handleMarkdownToggle = (state: EditorState, wrap: "*" | "**"): EditOperation | null => {
    const outerParts = getTextParts(state.value.slice(state.selectionStart, state.selectionEnd));
    const externalMarkerDepth = countExternalMarkerDepth(state, "*");
    const includedMarkerDepth = countIncludedMarkerDepth(outerParts.content, "*");
    const currentDepth = externalMarkerDepth + includedMarkerDepth;
    if (currentDepth > 0) {
        const marker = "*".repeat(getToggledAsteriskDepth(currentDepth, wrap.length as 1 | 2));
        return createFormattingEdit(
            state,
            state.selectionStart - externalMarkerDepth,
            state.selectionEnd + externalMarkerDepth,
            getCombinedTextParts(outerParts, includedMarkerDepth),
            marker
        );
    }

    const contentState = getNonWhitespaceSelection(state);
    if (!contentState) {
        return null;
    }
    return createFormattingEdit(
        contentState,
        contentState.selectionStart,
        contentState.selectionEnd,
        getTextParts(contentState.value.slice(contentState.selectionStart, contentState.selectionEnd)),
        wrap
    );
};

const handleGenericToggle = (state: EditorState, wrap: string): EditOperation | null => {
    const character = wrap[0];
    const isRepeatedCharacterMarker = Boolean(character) && [...wrap].every((value) => value === character);
    const outerParts = getTextParts(state.value.slice(state.selectionStart, state.selectionEnd));
    if (isRepeatedCharacterMarker) {
        const externalMarkerDepth = countExternalMarkerDepth(state, character);
        const includedMarkerDepth = countIncludedMarkerDepth(outerParts.content, character);
        if (externalMarkerDepth + includedMarkerDepth >= wrap.length) {
            return createFormattingEdit(
                state,
                state.selectionStart - externalMarkerDepth,
                state.selectionEnd + externalMarkerDepth,
                getCombinedTextParts(outerParts, includedMarkerDepth),
                ""
            );
        }
    }

    const contentState = getNonWhitespaceSelection(state);
    if (!contentState) {
        return null;
    }
    return createFormattingEdit(
        contentState,
        contentState.selectionStart,
        contentState.selectionEnd,
        getTextParts(contentState.value.slice(contentState.selectionStart, contentState.selectionEnd)),
        wrap
    );
};

const createSelectionMove = (state: EditorState, cursor: number): EditOperation => ({
    isTextReplacementRequired: false,
    replaceStart: state.selectionStart,
    replaceEnd: state.selectionEnd,
    text: "",
    selectionStart: cursor,
    selectionEnd: cursor,
    selectionDirection: "none"
});

export const skipClosingPair = (state: EditorState, character: string): EditOperation | null => {
    if (
        state.selectionStart !== state.selectionEnd ||
        !isClosingPairCharacter(character) ||
        state.value[state.selectionStart] !== character ||
        !isClosingPairMatched(state.value, state.selectionStart, character)
    ) {
        return null;
    }
    return createSelectionMove(state, state.selectionStart + character.length);
};

export const deleteEmptyPair = (state: EditorState): EditOperation | null => {
    if (state.selectionStart !== state.selectionEnd || state.selectionStart === 0) {
        return null;
    }
    const cursor = state.selectionStart;
    if (
        isCharacterEscaped(state.value, cursor - 1) ||
        !isEmptyCharacterPair(state.value[cursor - 1], state.value[cursor])
    ) {
        return null;
    }
    return createEdit(state, cursor - 1, cursor + 1, "", cursor - 1, cursor - 1, "none");
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

export const toggleWrap = (state: EditorState, wrap: string): EditOperation | null =>
    wrap === "*" || wrap === "**" ? handleMarkdownToggle(state, wrap) : handleGenericToggle(state, wrap);

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

export const escapeMarkdownLinkLabel = (label: string): string =>
    label.replace(/\\/g, "\\\\").replace(/\[/g, "\\[").replace(/\]/g, "\\]");

export const escapeMarkdownLinkDestination = (destination: string): string =>
    destination
        .replace(/\\/g, "\\\\")
        .replace(/\(/g, "\\(")
        .replace(/\)/g, "\\)")
        .replace(/</g, "%3C")
        .replace(/>/g, "%3E");

export const createMarkdownLinkFromPaste = (state: EditorState, pasteText: string): EditOperation | null => {
    const contentState = getNonWhitespaceSelection(state);
    if (!contentState || !isHyperlink(pasteText)) {
        return null;
    }

    const label = escapeMarkdownLinkLabel(
        contentState.value.slice(contentState.selectionStart, contentState.selectionEnd)
    );
    const destination = escapeMarkdownLinkDestination(pasteText.trim());
    const text = `[${label}](${destination})`;
    const cursor = contentState.selectionStart + text.length;
    return createEdit(
        contentState,
        contentState.selectionStart,
        contentState.selectionEnd,
        text,
        cursor,
        cursor,
        "none"
    );
};

export const createMarkdownLinkFromSelection = (state: EditorState): EditOperation | null => {
    const contentState = getNonWhitespaceSelection(state);
    if (!contentState) {
        return null;
    }

    const selectedText = contentState.value.slice(contentState.selectionStart, contentState.selectionEnd);
    if (isHyperlink(selectedText)) {
        const labelPlaceholder = "link text";
        const destination = escapeMarkdownLinkDestination(selectedText.trim());
        const text = `[${labelPlaceholder}](${destination})`;
        const selectionStart = contentState.selectionStart + 1;
        return createEdit(
            contentState,
            contentState.selectionStart,
            contentState.selectionEnd,
            text,
            selectionStart,
            selectionStart + labelPlaceholder.length
        );
    }

    const label = escapeMarkdownLinkLabel(selectedText);
    const destinationPlaceholder = "url";
    const text = `[${label}](${destinationPlaceholder})`;
    const selectionStart = contentState.selectionStart + label.length + 3;
    return createEdit(
        contentState,
        contentState.selectionStart,
        contentState.selectionEnd,
        text,
        selectionStart,
        selectionStart + destinationPlaceholder.length
    );
};
