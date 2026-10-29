import type { EditOperation, EditorState } from "./editor-state";
import type { BulletStyle } from "./line-prefixes";
import { getSelectedLineRange } from "./line-ranges";

export const CONCRETE_BLOCK_STYLES = [
    "text",
    "heading1",
    "heading2",
    "heading3",
    "heading4",
    "heading5",
    "heading6",
    "blockquote",
    "codeBlock",
    "bulletList",
    "numberedList",
    "taskList"
] as const;

export type ConcreteBlockStyle = (typeof CONCRETE_BLOCK_STYLES)[number];

export const ACTIVE_BLOCK_STYLES = [...CONCRETE_BLOCK_STYLES, "mixed"] as const;

export type ActiveBlockStyle = (typeof ACTIVE_BLOCK_STYLES)[number];

interface DocumentLine {
    readonly content: string;
    readonly start: number;
    readonly contentEnd: number;
    readonly lineEnding: string;
}

interface OpeningFence {
    readonly character: "`" | "~";
    readonly length: number;
}

interface FencedBlock {
    readonly startLineIndex: number;
    readonly endLineIndex: number;
    readonly contentStart: number;
    readonly contentEnd: number;
    readonly end: number;
}

interface LineBlockStyle {
    readonly style: ConcreteBlockStyle;
    readonly fencedBlockId: number | null;
}

interface OuterMarker {
    readonly style: Exclude<ConcreteBlockStyle, "text" | "codeBlock">;
    readonly start: number;
    readonly end: number;
}

interface TextEdit {
    readonly start: number;
    readonly end: number;
    readonly text: string;
    readonly insertionAffinity?: "before" | "after";
}

const OPENING_FENCE_PATTERN = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const CLOSING_FENCE_PATTERN = /^ {0,3}(`+|~+)[ \t]*$/;
const THEMATIC_BREAK_PATTERN = /^(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})$/;
const HEADING_PATTERN = /^(#{1,6})(?:[ \t]|$)/;
const TASK_LIST_PATTERN = /^[-+*][ \t]+\[[ xX]\](?:[ \t]|$)/;
const BULLET_LIST_PATTERN = /^[-+*](?:[ \t]|$)/;
const NUMBERED_LIST_PATTERN = /^\d+[.)](?:[ \t]|$)/;
const BLOCKQUOTE_PATTERN = /^>(?:[ \t])?/;

const getDocumentLines = (value: string): readonly DocumentLine[] => {
    const lines: DocumentLine[] = [];
    let start = 0;
    while (start <= value.length) {
        const lineFeedIndex = value.indexOf("\n", start);
        const rawEnd = lineFeedIndex >= 0 ? lineFeedIndex : value.length;
        const hasCarriageReturn = rawEnd > start && value[rawEnd - 1] === "\r";
        const contentEnd = hasCarriageReturn ? rawEnd - 1 : rawEnd;
        lines.push({
            content: value.slice(start, contentEnd),
            start,
            contentEnd,
            lineEnding: lineFeedIndex < 0 ? "" : hasCarriageReturn ? "\r\n" : "\n"
        });
        if (lineFeedIndex < 0) {
            break;
        }
        start = lineFeedIndex + 1;
    }
    return lines;
};

const getOpeningFence = (line: string): OpeningFence | null => {
    const match = line.match(OPENING_FENCE_PATTERN);
    if (!match) {
        return null;
    }

    const marker = match[1];
    const character = marker[0] as "`" | "~";
    const isBacktickInfoInvalid = character === "`" && match[2].includes("`");
    return isBacktickInfoInvalid ? null : { character, length: marker.length };
};

const isClosingFence = (line: string, openingFence: OpeningFence): boolean => {
    const match = line.match(CLOSING_FENCE_PATTERN);
    if (!match) {
        return false;
    }

    const marker = match[1];
    return marker[0] === openingFence.character && marker.length >= openingFence.length;
};

const findClosingFenceIndex = (
    lines: readonly DocumentLine[],
    openingLineIndex: number,
    openingFence: OpeningFence
): number => {
    for (let lineIndex = openingLineIndex + 1; lineIndex < lines.length; lineIndex += 1) {
        if (isClosingFence(lines[lineIndex].content, openingFence)) {
            return lineIndex;
        }
    }
    return -1;
};

const findFencedBlocks = (lines: readonly DocumentLine[]): readonly FencedBlock[] => {
    const blocks: FencedBlock[] = [];
    let lineIndex = 0;
    while (lineIndex < lines.length) {
        const openingFence = getOpeningFence(lines[lineIndex].content);
        if (!openingFence) {
            lineIndex += 1;
            continue;
        }

        const closingLineIndex = findClosingFenceIndex(lines, lineIndex, openingFence);
        if (closingLineIndex < 0) {
            lineIndex += 1;
            continue;
        }

        const contentStart = lines[lineIndex].contentEnd + lines[lineIndex].lineEnding.length;
        const contentEnd = lines[closingLineIndex].start;
        const end = lines[closingLineIndex].contentEnd + lines[closingLineIndex].lineEnding.length;
        blocks.push({
            startLineIndex: lineIndex,
            endLineIndex: closingLineIndex,
            contentStart,
            contentEnd,
            end
        });
        lineIndex = closingLineIndex + 1;
    }
    return blocks;
};

const getSelectedLineIndexes = (
    state: EditorState,
    lines: readonly DocumentLine[]
): { startLineIndex: number; endLineIndex: number } => {
    const range = getSelectedLineRange(state);
    const startLineIndex = lines.findIndex((line) => line.start === range.lineStarts[0]);
    return {
        startLineIndex,
        endLineIndex: startLineIndex + range.lines.length - 1
    };
};

const getContainingFencedBlock = (blocks: readonly FencedBlock[], lineIndex: number): FencedBlock | null =>
    blocks.find((block) => block.startLineIndex <= lineIndex && block.endLineIndex >= lineIndex) ?? null;

const getIndentationLength = (line: string): number => line.match(/^[ \t]*/)?.[0].length ?? 0;

const getOutermostMarker = (line: string): OuterMarker | null => {
    const indentationLength = getIndentationLength(line);
    const content = line.slice(indentationLength);
    if (THEMATIC_BREAK_PATTERN.test(content)) {
        return null;
    }

    const markerPatterns: readonly [OuterMarker["style"], RegExp][] = [
        ["heading1", HEADING_PATTERN],
        ["blockquote", BLOCKQUOTE_PATTERN],
        ["taskList", TASK_LIST_PATTERN],
        ["bulletList", BULLET_LIST_PATTERN],
        ["numberedList", NUMBERED_LIST_PATTERN]
    ];
    for (const [style, pattern] of markerPatterns) {
        const match = content.match(pattern);
        if (!match) {
            continue;
        }
        const resolvedStyle = style === "heading1" ? (`heading${match[1].length}` as OuterMarker["style"]) : style;
        return {
            style: resolvedStyle,
            start: indentationLength,
            end: indentationLength + match[0].length
        };
    }
    return null;
};

const getLineBlockStyle = (line: string): ConcreteBlockStyle => getOutermostMarker(line)?.style ?? "text";

const getSelectedLineBlockStyle = (
    line: DocumentLine,
    lineIndex: number,
    fencedBlocks: readonly FencedBlock[]
): LineBlockStyle | null => {
    const fencedBlock = getContainingFencedBlock(fencedBlocks, lineIndex);
    if (fencedBlock) {
        return { style: "codeBlock", fencedBlockId: fencedBlock.startLineIndex };
    }
    if (line.content.trim() === "") {
        return null;
    }
    return { style: getLineBlockStyle(line.content), fencedBlockId: null };
};

export const getActiveBlockStyle = (state: EditorState): ActiveBlockStyle => {
    const lines = getDocumentLines(state.value);
    const { startLineIndex, endLineIndex } = getSelectedLineIndexes(state, lines);
    const fencedBlocks = findFencedBlocks(lines);
    let activeLineStyle: LineBlockStyle | null = null;

    for (let lineIndex = startLineIndex; lineIndex <= endLineIndex; lineIndex += 1) {
        const lineStyle = getSelectedLineBlockStyle(lines[lineIndex], lineIndex, fencedBlocks);
        if (!lineStyle) {
            continue;
        }
        if (
            activeLineStyle &&
            (activeLineStyle.style !== lineStyle.style || activeLineStyle.fencedBlockId !== lineStyle.fencedBlockId)
        ) {
            return "mixed";
        }
        activeLineStyle = lineStyle;
    }
    return activeLineStyle?.style ?? "text";
};

const getStylePrefix = (style: Exclude<ConcreteBlockStyle, "text" | "codeBlock">, bulletStyle: BulletStyle): string => {
    if (style.startsWith("heading")) {
        return `${"#".repeat(Number(style.slice("heading".length)))} `;
    }
    const prefixes: Readonly<Record<Exclude<ConcreteBlockStyle, "text" | "codeBlock" | `heading${number}`>, string>> = {
        blockquote: "> ",
        bulletList: `${bulletStyle} `,
        numberedList: "1. ",
        taskList: `${bulletStyle} [ ] `
    };
    return prefixes[style as keyof typeof prefixes];
};

const createLineStyleEdit = (
    line: DocumentLine,
    style: Exclude<ConcreteBlockStyle, "codeBlock">,
    bulletStyle: BulletStyle,
    isCollapsedEmptyLine: boolean
): TextEdit | null => {
    const isBlankLine = line.content.trim() === "";
    if (isBlankLine && !isCollapsedEmptyLine) {
        return null;
    }

    const marker = getOutermostMarker(line.content);
    if (style === "text") {
        return marker ? { start: line.start + marker.start, end: line.start + marker.end, text: "" } : null;
    }
    if (marker?.style === style) {
        return null;
    }

    const markerStart = marker?.start ?? getIndentationLength(line.content);
    const markerEnd = marker?.end ?? markerStart;
    return {
        start: line.start + markerStart,
        end: line.start + markerEnd,
        text: getStylePrefix(style, bulletStyle),
        insertionAffinity: markerStart === markerEnd ? "after" : undefined
    };
};

const getPreferredLineEnding = (value: string, start: number, end: number, followingLineEnding: string): string => {
    const localLineEnding = value.slice(start, end).match(/\r\n|\n/)?.[0];
    if (localLineEnding || followingLineEnding) {
        return localLineEnding ?? followingLineEnding;
    }

    let precedingLineEnding: string | undefined;
    for (const match of value.slice(0, start).matchAll(/\r\n|\n/g)) {
        precedingLineEnding = match[0];
    }
    return precedingLineEnding ?? "\n";
};

const getCodeFence = (content: string): string => {
    let longestRun = 0;
    for (const match of content.matchAll(/`+/g)) {
        longestRun = Math.max(longestRun, match[0].length);
    }
    return "`".repeat(Math.max(3, longestRun + 1));
};

const createCodeWrapEdits = (
    value: string,
    lines: readonly DocumentLine[],
    startLineIndex: number,
    endLineIndex: number
): readonly TextEdit[] => {
    const start = lines[startLineIndex].start;
    const end = lines[endLineIndex].contentEnd;
    const content = value.slice(start, end);
    const lineEnding = getPreferredLineEnding(value, start, end, lines[startLineIndex].lineEnding);
    const fence = getCodeFence(content);
    return [
        { start, end: start, text: `${fence}${lineEnding}`, insertionAffinity: "after" },
        { start: end, end, text: `${lineEnding}${fence}`, insertionAffinity: "before" }
    ];
};

const getCollapsedEmptyFenceMarkerPosition = (
    state: EditorState,
    lines: readonly DocumentLine[],
    block: FencedBlock,
    style: Exclude<ConcreteBlockStyle, "codeBlock">,
    selectedLineIndex: number
): number | null => {
    if (style === "text" || state.selectionStart !== state.selectionEnd) {
        return null;
    }
    const contentLines = lines.slice(block.startLineIndex + 1, block.endLineIndex);
    if (contentLines.some((line) => line.content.trim() !== "")) {
        return null;
    }
    const selectedContentLine =
        selectedLineIndex > block.startLineIndex && selectedLineIndex < block.endLineIndex
            ? lines[selectedLineIndex]
            : contentLines[0];
    return selectedContentLine
        ? selectedContentLine.start + getIndentationLength(selectedContentLine.content)
        : block.contentStart;
};

const createFenceConversionEdits = (
    lines: readonly DocumentLine[],
    block: FencedBlock,
    style: Exclude<ConcreteBlockStyle, "codeBlock">,
    bulletStyle: BulletStyle,
    collapsedEmptyMarkerPosition: number | null
): readonly TextEdit[] => {
    const edits: TextEdit[] = [
        {
            start: lines[block.startLineIndex].start,
            end: block.contentStart,
            text: ""
        },
        {
            start: block.contentEnd,
            end: block.end,
            text: ""
        }
    ];
    if (style !== "text") {
        for (let lineIndex = block.startLineIndex + 1; lineIndex < block.endLineIndex; lineIndex += 1) {
            const line = lines[lineIndex];
            const markerPosition = line.start + getIndentationLength(line.content);
            const isCollapsedEmptyLine = collapsedEmptyMarkerPosition === markerPosition;
            const edit = createLineStyleEdit(line, style, bulletStyle, isCollapsedEmptyLine);
            if (edit) {
                edits.push(edit);
            }
        }
        if (block.endLineIndex === block.startLineIndex + 1 && collapsedEmptyMarkerPosition !== null) {
            edits.push({
                start: collapsedEmptyMarkerPosition,
                end: collapsedEmptyMarkerPosition,
                text: getStylePrefix(style, bulletStyle),
                insertionAffinity: "after"
            });
        }
    }
    if (block.endLineIndex === block.startLineIndex + 1 && lines[block.endLineIndex].lineEnding !== "") {
        edits.push({
            start: block.contentStart,
            end: block.contentStart,
            text: lines[block.endLineIndex].lineEnding,
            insertionAffinity: "before"
        });
    }
    return edits;
};

const sortTextEdits = (edits: readonly TextEdit[]): readonly TextEdit[] =>
    [...edits].sort((left, right) => left.start - right.start || left.end - right.end);

const createEditedText = (
    value: string,
    replaceStart: number,
    replaceEnd: number,
    edits: readonly TextEdit[]
): string => {
    let sourcePosition = replaceStart;
    let text = "";
    for (const edit of edits) {
        if (edit.start < sourcePosition || edit.end > replaceEnd) {
            throw new Error("Block style edits must be ordered and non-overlapping");
        }
        text += value.slice(sourcePosition, edit.start) + edit.text;
        sourcePosition = edit.end;
    }
    return text + value.slice(sourcePosition, replaceEnd);
};

const mapPositionAfterEdits = (position: number, edits: readonly TextEdit[]): number => {
    let delta = 0;
    for (const edit of edits) {
        if (position < edit.start) {
            break;
        }
        if (edit.start === edit.end) {
            if (position === edit.start && edit.insertionAffinity === "before") {
                continue;
            }
            delta += edit.text.length;
            continue;
        }
        if (position === edit.start || position < edit.end) {
            return edit.start + delta + edit.text.length;
        }
        delta += edit.text.length - (edit.end - edit.start);
    }
    return position + delta;
};

const createEditOperation = (
    state: EditorState,
    edits: readonly TextEdit[],
    forcedReplaceStart?: number,
    forcedReplaceEnd?: number,
    selectionStartSourcePosition: number = state.selectionStart,
    selectionEndSourcePosition: number = state.selectionEnd
): EditOperation | null => {
    if (edits.length === 0) {
        return null;
    }
    const sortedEdits = sortTextEdits(edits);
    const replaceStart = forcedReplaceStart ?? sortedEdits[0].start;
    const replaceEnd = forcedReplaceEnd ?? Math.max(...sortedEdits.map((edit) => edit.end));
    const text = createEditedText(state.value, replaceStart, replaceEnd, sortedEdits);
    if (text === state.value.slice(replaceStart, replaceEnd)) {
        return null;
    }
    return {
        isTextReplacementRequired: true,
        replaceStart,
        replaceEnd,
        text,
        selectionStart: mapPositionAfterEdits(selectionStartSourcePosition, sortedEdits),
        selectionEnd: mapPositionAfterEdits(selectionEndSourcePosition, sortedEdits),
        selectionDirection: state.selectionDirection
    };
};

const expandCodeBlockLineRange = (
    fencedBlocks: readonly FencedBlock[],
    startLineIndex: number,
    endLineIndex: number
): { startLineIndex: number; endLineIndex: number } => {
    let expandedStartLineIndex = startLineIndex;
    let expandedEndLineIndex = endLineIndex;
    let isExpansionPending = true;
    while (isExpansionPending) {
        isExpansionPending = false;
        for (const block of fencedBlocks) {
            if (block.startLineIndex > expandedEndLineIndex || block.endLineIndex < expandedStartLineIndex) {
                continue;
            }
            const nextStartLineIndex = Math.min(expandedStartLineIndex, block.startLineIndex);
            const nextEndLineIndex = Math.max(expandedEndLineIndex, block.endLineIndex);
            if (nextStartLineIndex !== expandedStartLineIndex || nextEndLineIndex !== expandedEndLineIndex) {
                expandedStartLineIndex = nextStartLineIndex;
                expandedEndLineIndex = nextEndLineIndex;
                isExpansionPending = true;
            }
        }
    }
    return { startLineIndex: expandedStartLineIndex, endLineIndex: expandedEndLineIndex };
};

const clampPositionToRange = (position: number, start: number, end: number): number =>
    Math.min(Math.max(position, start), end);

export const applyBlockStyle = (
    state: EditorState,
    style: ConcreteBlockStyle,
    bulletStyle: BulletStyle = "-"
): EditOperation | null => {
    if (getActiveBlockStyle(state) === style) {
        return null;
    }

    const lines = getDocumentLines(state.value);
    const { startLineIndex, endLineIndex } = getSelectedLineIndexes(state, lines);
    const fencedBlocks = findFencedBlocks(lines);
    if (style === "codeBlock") {
        const expandedRange = expandCodeBlockLineRange(fencedBlocks, startLineIndex, endLineIndex);
        const wrapStart = lines[expandedRange.startLineIndex].start;
        const wrapEnd = lines[expandedRange.endLineIndex].contentEnd;
        const selectionStartSourcePosition = clampPositionToRange(state.selectionStart, wrapStart, wrapEnd);
        const selectionEndSourcePosition = Math.max(
            selectionStartSourcePosition,
            clampPositionToRange(state.selectionEnd, wrapStart, wrapEnd)
        );
        return createEditOperation(
            state,
            createCodeWrapEdits(state.value, lines, expandedRange.startLineIndex, expandedRange.endLineIndex),
            wrapStart,
            wrapEnd,
            selectionStartSourcePosition,
            selectionEndSourcePosition
        );
    }

    const edits: TextEdit[] = [];
    const intersectedBlocks = fencedBlocks.filter(
        (block) => block.startLineIndex <= endLineIndex && block.endLineIndex >= startLineIndex
    );
    let forcedCursorSourcePosition: number | null = null;
    for (const block of intersectedBlocks) {
        const markerPosition = getCollapsedEmptyFenceMarkerPosition(state, lines, block, style, startLineIndex);
        if (markerPosition !== null) {
            forcedCursorSourcePosition = markerPosition;
        }
        edits.push(...createFenceConversionEdits(lines, block, style, bulletStyle, markerPosition));
    }

    for (let lineIndex = startLineIndex; lineIndex <= endLineIndex; lineIndex += 1) {
        if (getContainingFencedBlock(intersectedBlocks, lineIndex)) {
            continue;
        }
        const isCollapsedEmptyLine = state.selectionStart === state.selectionEnd && startLineIndex === endLineIndex;
        const edit = createLineStyleEdit(lines[lineIndex], style, bulletStyle, isCollapsedEmptyLine);
        if (edit) {
            edits.push(edit);
            if (isCollapsedEmptyLine && style !== "text" && lines[lineIndex].content.trim() === "") {
                forcedCursorSourcePosition = edit.start;
            }
        }
    }
    const replaceStart = Math.min(
        lines[startLineIndex].start,
        ...intersectedBlocks.map((block) => lines[block.startLineIndex].start)
    );
    const replaceEnd = Math.max(lines[endLineIndex].contentEnd, ...intersectedBlocks.map((block) => block.end));
    const operation = createEditOperation(state, edits, replaceStart, replaceEnd);
    if (!operation || forcedCursorSourcePosition === null) {
        return operation;
    }
    const mappedCursor = mapPositionAfterEdits(forcedCursorSourcePosition, sortTextEdits(edits));
    return {
        ...operation,
        selectionStart: mappedCursor,
        selectionEnd: mappedCursor
    };
};
