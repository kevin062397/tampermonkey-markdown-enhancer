import type { EditOperation, EditorState } from "./editor-state";

interface TextParts {
    readonly leadingWhitespace: string;
    readonly content: string;
    readonly trailingWhitespace: string;
}

interface ExternalInlineDelimiter {
    readonly delimiterLength: number;
    readonly paddingLength: number;
}

interface LineInfo {
    readonly start: number;
    readonly contentEnd: number;
    readonly breakEnd: number;
    readonly text: string;
}

interface FencedCodeBlock {
    readonly start: number;
    readonly end: number;
    readonly content: string;
}

interface FencedCodeContext {
    readonly block: FencedCodeBlock | null;
    readonly isTransformationBlocked: boolean;
}

const createEdit = (
    state: EditorState,
    replaceStart: number,
    replaceEnd: number,
    text: string,
    selectionStart: number,
    selectionEnd: number
): EditOperation => ({
    isTextReplacementRequired: true,
    replaceStart,
    replaceEnd,
    text,
    selectionStart,
    selectionEnd,
    selectionDirection: state.selectionDirection
});

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

const countBackticksBefore = (value: string, index: number): number => {
    let count = 0;
    while (index - count - 1 >= 0 && value[index - count - 1] === "`") {
        count += 1;
    }
    return count;
};

const countBackticksAfter = (value: string, index: number): number => {
    let count = 0;
    while (index + count < value.length && value[index + count] === "`") {
        count += 1;
    }
    return count;
};

const getMatchingDelimiterLength = (leadingLength: number, trailingLength: number): number =>
    leadingLength > 0 && leadingLength === trailingLength ? leadingLength : 0;

const getExternalInlineDelimiter = (state: EditorState): ExternalInlineDelimiter | null => {
    const directLength = getMatchingDelimiterLength(
        countBackticksBefore(state.value, state.selectionStart),
        countBackticksAfter(state.value, state.selectionEnd)
    );
    if (directLength) {
        return { delimiterLength: directLength, paddingLength: 0 };
    }

    if (state.value[state.selectionStart - 1] !== " " || state.value[state.selectionEnd] !== " ") {
        return null;
    }
    const paddedLength = getMatchingDelimiterLength(
        countBackticksBefore(state.value, state.selectionStart - 1),
        countBackticksAfter(state.value, state.selectionEnd + 1)
    );
    return paddedLength ? { delimiterLength: paddedLength, paddingLength: 1 } : null;
};

const countIncludedDelimiterLength = (text: string): number =>
    getMatchingDelimiterLength(countBackticksAfter(text, 0), countBackticksBefore(text, text.length));

const isInlineCodeSpanValid = (text: string, delimiterLength: number): boolean =>
    Boolean(text) && !(text.match(/`+/g) ?? []).some((run) => run.length === delimiterLength);

const removeSyntheticCodePadding = (text: string): string => {
    if (text.startsWith(" ") && text.endsWith(" ")) {
        const unpadded = text.slice(1, -1);
        if (unpadded.startsWith("`") || unpadded.endsWith("`")) {
            return unpadded;
        }
    }
    return text;
};

const getMaximumBacktickRun = (text: string): number =>
    Math.max(0, ...(text.match(/`+/g)?.map((run) => run.length) ?? []));

const isSelectionInsideInlineCodeSpan = (state: EditorState): boolean => {
    const openingRuns = new Map<number, { readonly start: number; readonly end: number }>();
    for (const match of state.value.matchAll(/`+/g)) {
        const start = match.index;
        const end = start + match[0].length;
        const openingRun = openingRuns.get(match[0].length);
        if (!openingRun) {
            openingRuns.set(match[0].length, { start, end });
            continue;
        }
        if (openingRun.end <= state.selectionStart && state.selectionEnd <= start) {
            return true;
        }
        openingRuns.delete(match[0].length);
    }
    return false;
};

export const toggleInlineCode = (state: EditorState): EditOperation | null => {
    if (state.selectionStart === state.selectionEnd) {
        return null;
    }

    const selectedText = state.value.slice(state.selectionStart, state.selectionEnd);
    const externalDelimiter = getExternalInlineDelimiter(state);
    const outerParts = getTextParts(selectedText);
    const includedDelimiterLength = externalDelimiter?.paddingLength
        ? 0
        : countIncludedDelimiterLength(outerParts.content);
    const existingDelimiterLength = (externalDelimiter?.delimiterLength ?? 0) + includedDelimiterLength;
    const innerText = includedDelimiterLength
        ? outerParts.content.slice(includedDelimiterLength, -includedDelimiterLength)
        : outerParts.content;
    if (existingDelimiterLength && isInlineCodeSpanValid(innerText, existingDelimiterLength)) {
        const content = removeSyntheticCodePadding(innerText);
        const replaceStart =
            state.selectionStart - (externalDelimiter?.delimiterLength ?? 0) - (externalDelimiter?.paddingLength ?? 0);
        const replaceEnd =
            state.selectionEnd + (externalDelimiter?.paddingLength ?? 0) + (externalDelimiter?.delimiterLength ?? 0);
        const text = outerParts.leadingWhitespace + content + outerParts.trailingWhitespace;
        const selectionStart = replaceStart + outerParts.leadingWhitespace.length;
        return createEdit(state, replaceStart, replaceEnd, text, selectionStart, selectionStart + content.length);
    }

    if (!outerParts.content || isSelectionInsideInlineCodeSpan(state)) {
        return null;
    }
    let contentStart = state.selectionStart + outerParts.leadingWhitespace.length;
    let contentEnd = state.selectionEnd - outerParts.trailingWhitespace.length;
    while (contentStart > 0 && state.value[contentStart - 1] === "`") {
        contentStart -= 1;
    }
    while (contentEnd < state.value.length && state.value[contentEnd] === "`") {
        contentEnd += 1;
    }
    const content = state.value.slice(contentStart, contentEnd);
    const delimiter = "`".repeat(getMaximumBacktickRun(content) + 1);
    const isPaddingRequired = content.startsWith("`") || content.endsWith("`");
    const padding = isPaddingRequired ? " " : "";
    const text = delimiter + padding + content + padding + delimiter;
    const selectionStart = contentStart + delimiter.length + padding.length;
    return createEdit(state, contentStart, contentEnd, text, selectionStart, selectionStart + content.length);
};

const getLineInfo = (value: string, start: number): LineInfo => {
    const lineEnd = value.indexOf("\n", start);
    const breakEnd = lineEnd >= 0 ? lineEnd + 1 : value.length;
    const rawContentEnd = lineEnd >= 0 ? lineEnd : value.length;
    const contentEnd = value[rawContentEnd - 1] === "\r" ? rawContentEnd - 1 : rawContentEnd;
    return { start, contentEnd, breakEnd, text: value.slice(start, contentEnd) };
};

const getNewlineAtBreak = (value: string, breakIndex: number): "\n" | "\r\n" =>
    value[breakIndex - 1] === "\r" ? "\r\n" : "\n";

const getPreferredNewline = (state: EditorState, content: string): "\n" | "\r\n" => {
    const selectedBreakOffset = content.indexOf("\n");
    if (selectedBreakOffset >= 0) {
        return getNewlineAtBreak(content, selectedBreakOffset);
    }
    const nextBreak = state.value.indexOf("\n", state.selectionEnd);
    if (nextBreak >= 0) {
        return getNewlineAtBreak(state.value, nextBreak);
    }
    const previousBreak = state.value.lastIndexOf("\n", state.selectionStart - 1);
    return previousBreak >= 0 ? getNewlineAtBreak(state.value, previousBreak) : "\n";
};

const getBoundaryNewlineLength = (value: string, end: number): number => (value.slice(end - 2, end) === "\r\n" ? 2 : 1);

const findFencedCodeContext = (state: EditorState): FencedCodeContext => {
    let openingStart = 0;
    while (openingStart < state.value.length) {
        const openingLine = getLineInfo(state.value, openingStart);
        const openingMatch = openingLine.text.match(/^( {0,3})(`{3,}|~{3,})(.*)$/);
        if (!openingMatch || (openingMatch[2][0] === "`" && openingMatch[3].includes("`"))) {
            openingStart = openingLine.breakEnd;
            continue;
        }

        const fence = openingMatch[2];
        const fenceCharacter = fence[0];
        let closingStart = openingLine.breakEnd;
        while (closingStart < state.value.length) {
            const closingLine = getLineInfo(state.value, closingStart);
            const closingMatch = closingLine.text.match(/^ {0,3}(`{3,}|~{3,})[ \t]*$/);
            if (closingMatch && closingMatch[1][0] === fenceCharacter && closingMatch[1].length >= fence.length) {
                const blockEnd = closingLine.breakEnd;
                const isSelectionInside = state.selectionStart >= openingStart && state.selectionEnd <= blockEnd;
                const isSelectionIntersecting = state.selectionStart < blockEnd && state.selectionEnd > openingStart;
                if (isSelectionInside && fenceCharacter === "`") {
                    const separatorLength = getBoundaryNewlineLength(state.value, closingStart);
                    const contentEnd = Math.max(openingLine.breakEnd, closingStart - separatorLength);
                    return {
                        block: {
                            start: openingStart,
                            end: closingLine.contentEnd,
                            content: state.value.slice(openingLine.breakEnd, contentEnd)
                        },
                        isTransformationBlocked: false
                    };
                }
                if (isSelectionIntersecting) {
                    return { block: null, isTransformationBlocked: true };
                }
                openingStart = blockEnd;
                break;
            }
            if (closingLine.breakEnd <= closingStart) {
                return { block: null, isTransformationBlocked: false };
            }
            closingStart = closingLine.breakEnd;
        }
        if (closingStart >= state.value.length) {
            const isSelectionIntersecting =
                state.selectionStart < state.value.length && state.selectionEnd > openingStart;
            const isUnclosedFenceFullySelected =
                fenceCharacter === "`" &&
                state.selectionStart <= openingStart &&
                state.selectionEnd === state.value.length;
            return {
                block: null,
                isTransformationBlocked: isSelectionIntersecting && !isUnclosedFenceFullySelected
            };
        }
    }
    return { block: null, isTransformationBlocked: false };
};

const getSelectedLineContentRange = (state: EditorState): { readonly start: number; readonly end: number } => {
    const start = state.selectionStart === 0 ? 0 : state.value.lastIndexOf("\n", state.selectionStart - 1) + 1;
    const isSelectionEndingAtLineStart =
        state.selectionEnd > state.selectionStart && state.value[state.selectionEnd - 1] === "\n";
    if (isSelectionEndingAtLineStart && state.selectionEnd === state.value.length) {
        return { start, end: state.selectionEnd };
    }
    const lastSelectedPosition = isSelectionEndingAtLineStart ? state.selectionEnd - 1 : state.selectionEnd;
    const nextBreak = state.value.indexOf("\n", lastSelectedPosition);
    const rawEnd = nextBreak >= 0 ? nextBreak : state.value.length;
    const end = state.value[rawEnd - 1] === "\r" ? rawEnd - 1 : rawEnd;
    return { start, end };
};

export const toggleFencedCodeBlock = (state: EditorState): EditOperation | null => {
    if (state.selectionStart === state.selectionEnd) {
        return null;
    }
    const context = findFencedCodeContext(state);
    if (context.block) {
        return createEdit(
            state,
            context.block.start,
            context.block.end,
            context.block.content,
            context.block.start,
            context.block.start + context.block.content.length
        );
    }
    if (context.isTransformationBlocked) {
        return null;
    }

    const range = getSelectedLineContentRange(state);
    const content = state.value.slice(range.start, range.end);
    const fence = "`".repeat(Math.max(3, getMaximumBacktickRun(content) + 1));
    const languagePlaceholder = "language";
    const newline = getPreferredNewline(state, content);
    const text = `${fence}${languagePlaceholder}${newline}${content}${newline}${fence}`;
    const selectionStart = range.start + fence.length;
    return createEdit(state, range.start, range.end, text, selectionStart, selectionStart + languagePlaceholder.length);
};
