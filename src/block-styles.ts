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

type LineBlockStyle = Exclude<ConcreteBlockStyle, "codeBlock">;

interface DocumentLine {
    readonly start: number;
    readonly contentEnd: number;
    readonly breakEnd: number;
    readonly text: string;
}

interface FenceOpener {
    readonly character: "`" | "~";
    readonly length: number;
}

interface FencedCodeBlock {
    readonly id: number;
    readonly startLine: number;
    readonly endLine: number;
    readonly contentStart: number;
    readonly contentEnd: number;
}

interface ParsedBlockMarker {
    readonly style: Exclude<LineBlockStyle, "text">;
    readonly startOffset: number;
    readonly endOffset: number;
}

interface TextChange {
    readonly start: number;
    readonly end: number;
    readonly mapEnd?: number;
    readonly text: string;
    readonly mapPosition: (position: number) => number;
}

const THEMATIC_BREAK_PATTERN = /^(?:\*(?:[ \t]*\*){2,}|-(?:[ \t]*-){2,}|_(?:[ \t]*_){2,})[ \t]*$/;

const parseDocumentLines = (value: string): readonly DocumentLine[] => {
    const lines: DocumentLine[] = [];
    let start = 0;

    while (start <= value.length) {
        const lineFeed = value.indexOf("\n", start);
        const rawContentEnd = lineFeed >= 0 ? lineFeed : value.length;
        const contentEnd = value[rawContentEnd - 1] === "\r" ? rawContentEnd - 1 : rawContentEnd;
        const breakEnd = lineFeed >= 0 ? lineFeed + 1 : value.length;
        lines.push({ start, contentEnd, breakEnd, text: value.slice(start, contentEnd) });
        if (lineFeed < 0) {
            break;
        }
        start = breakEnd;
    }

    return lines;
};

const parseFenceOpener = (line: string): FenceOpener | null => {
    const match = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (!match) {
        return null;
    }

    const fence = match[1];
    const character = fence[0] as "`" | "~";
    const info = match[2];
    if (character === "`" && info.includes("`")) {
        return null;
    }

    return { character, length: fence.length };
};

const isFenceCloser = (line: string, opener: FenceOpener): boolean => {
    const body = line.replace(/^ {0,3}/, "");
    let length = 0;
    while (body[length] === opener.character) {
        length += 1;
    }
    return length >= opener.length && /^[ \t]*$/.test(body.slice(length));
};

const findFencedCodeBlocks = (lines: readonly DocumentLine[]): readonly FencedCodeBlock[] => {
    const blocks: FencedCodeBlock[] = [];

    for (let startLine = 0; startLine < lines.length; startLine += 1) {
        const opener = parseFenceOpener(lines[startLine].text);
        if (!opener) {
            continue;
        }

        let endLine = startLine + 1;
        while (endLine < lines.length && !isFenceCloser(lines[endLine].text, opener)) {
            endLine += 1;
        }
        if (endLine === lines.length) {
            continue;
        }

        const contentStart = lines[startLine].breakEnd;
        const contentEnd = lines[endLine].start;
        blocks.push({ id: blocks.length, startLine, endLine, contentStart, contentEnd });
        startLine = endLine;
    }

    return blocks;
};

const getIndentationLength = (line: string): number => line.match(/^[ \t]*/)?.[0].length ?? 0;

const parseBlockMarker = (line: string): ParsedBlockMarker | null => {
    const startOffset = getIndentationLength(line);
    const body = line.slice(startOffset);
    if (THEMATIC_BREAK_PATTERN.test(body)) {
        return null;
    }

    const heading = body.match(/^(#{1,6})(?:[ \t]|$)/);
    if (heading) {
        return {
            style: `heading${heading[1].length}` as Exclude<LineBlockStyle, "text">,
            startOffset,
            endOffset: startOffset + heading[0].length
        };
    }

    const blockquote = body.match(/^>(?:[ \t])?/);
    if (blockquote) {
        return { style: "blockquote", startOffset, endOffset: startOffset + blockquote[0].length };
    }

    const taskList = body.match(/^[-+*][ \t]+\[[ xX]\](?:[ \t]|$)/);
    if (taskList) {
        return { style: "taskList", startOffset, endOffset: startOffset + taskList[0].length };
    }

    const bulletList = body.match(/^[-+*](?:[ \t]|$)/);
    if (bulletList) {
        return { style: "bulletList", startOffset, endOffset: startOffset + bulletList[0].length };
    }

    const numberedList = body.match(/^\d+[.)](?:[ \t]|$)/);
    if (numberedList) {
        return { style: "numberedList", startOffset, endOffset: startOffset + numberedList[0].length };
    }

    return null;
};

const getLineStyle = (line: string): LineBlockStyle => parseBlockMarker(line)?.style ?? "text";

const getLineIndexes = (state: EditorState, lines: readonly DocumentLine[]): readonly number[] => {
    const indexesByStart = new Map(lines.map((line, index) => [line.start, index]));
    return getSelectedLineRange(state).lineStarts.flatMap((start) => {
        const index = indexesByStart.get(start);
        return index === undefined ? [] : [index];
    });
};

const createFenceIdsByLine = (blocks: readonly FencedCodeBlock[]): ReadonlyMap<number, number> => {
    const idsByLine = new Map<number, number>();
    for (const block of blocks) {
        for (let lineIndex = block.startLine; lineIndex <= block.endLine; lineIndex += 1) {
            idsByLine.set(lineIndex, block.id);
        }
    }
    return idsByLine;
};

const getActiveBlockStyleFromParsedDocument = (
    state: EditorState,
    lines: readonly DocumentLine[],
    blocks: readonly FencedCodeBlock[]
): ActiveBlockStyle => {
    const fenceIdsByLine = createFenceIdsByLine(blocks);
    let activeStyle: ConcreteBlockStyle | undefined;
    let activeFenceId: number | undefined;

    for (const lineIndex of getLineIndexes(state, lines)) {
        const fenceId = fenceIdsByLine.get(lineIndex);
        const content = lines[lineIndex].text;
        if (fenceId === undefined && /^[ \t]*$/.test(content)) {
            continue;
        }

        const style = fenceId === undefined ? getLineStyle(content) : "codeBlock";
        if (activeStyle !== undefined && (activeStyle !== style || activeFenceId !== fenceId)) {
            return "mixed";
        }

        activeStyle = style;
        activeFenceId = fenceId;
    }

    return activeStyle ?? "text";
};

export const getActiveBlockStyle = (state: EditorState): ActiveBlockStyle => {
    const lines = parseDocumentLines(state.value);
    return getActiveBlockStyleFromParsedDocument(state, lines, findFencedCodeBlocks(lines));
};

const getBlockPrefix = (style: Exclude<ConcreteBlockStyle, "text" | "codeBlock">, bulletStyle: BulletStyle): string => {
    if (style.startsWith("heading")) {
        return `${"#".repeat(Number(style.slice("heading".length)))} `;
    }
    if (style === "blockquote") {
        return "> ";
    }
    if (style === "bulletList") {
        return `${bulletStyle} `;
    }
    if (style === "numberedList") {
        return "1. ";
    }
    return `${bulletStyle} [ ] `;
};

const createLineStyleChange = (
    line: DocumentLine,
    targetStyle: Exclude<ConcreteBlockStyle, "codeBlock">,
    bulletStyle: BulletStyle,
    shouldStyleCollapsedBlankLine: boolean
): TextChange | null => {
    const isBlank = /^[ \t]*$/.test(line.text);
    if (isBlank) {
        if (!shouldStyleCollapsedBlankLine || targetStyle === "text") {
            return null;
        }

        const prefix = getBlockPrefix(targetStyle, bulletStyle);
        const text = `${line.text}${prefix}`;
        return {
            start: line.start,
            end: line.contentEnd,
            text,
            mapPosition: () => text.length
        };
    }

    const marker = parseBlockMarker(line.text);
    if (targetStyle === "text") {
        if (!marker) {
            return null;
        }
        const start = line.start + marker.startOffset;
        const end = line.start + marker.endOffset;
        return { start, end, text: "", mapPosition: () => 0 };
    }

    if (marker?.style === targetStyle) {
        return null;
    }

    const text = getBlockPrefix(targetStyle, bulletStyle);
    const markerStart = marker?.startOffset ?? getIndentationLength(line.text);
    const markerEnd = marker?.endOffset ?? markerStart;
    const start = line.start + markerStart;
    const end = line.start + markerEnd;
    return { start, end, text, mapPosition: () => text.length };
};

const mapPositionThroughChanges = (position: number, changes: readonly TextChange[]): number => {
    let delta = 0;
    for (const change of changes) {
        if (position < change.start) {
            break;
        }
        if (position <= (change.mapEnd ?? change.end)) {
            return change.start + delta + change.mapPosition(position);
        }
        delta += change.text.length - (change.end - change.start);
    }
    return position + delta;
};

const createChangedText = (
    value: string,
    replaceStart: number,
    replaceEnd: number,
    changes: readonly TextChange[]
): string => {
    let cursor = replaceStart;
    let text = "";
    for (const change of changes) {
        text += value.slice(cursor, change.start) + change.text;
        cursor = change.end;
    }
    return text + value.slice(cursor, replaceEnd);
};

const createEditOperation = (state: EditorState, changes: readonly TextChange[]): EditOperation | null => {
    if (changes.length === 0) {
        return null;
    }

    const replaceStart = changes[0].start;
    const replaceEnd = changes.at(-1)?.end ?? replaceStart;
    const text = createChangedText(state.value, replaceStart, replaceEnd, changes);
    const resultLength = state.value.length - (replaceEnd - replaceStart) + text.length;
    const clampPosition = (position: number): number => Math.min(Math.max(position, 0), resultLength);
    const mappedSelectionStart = clampPosition(mapPositionThroughChanges(state.selectionStart, changes));
    const mappedSelectionEnd = clampPosition(mapPositionThroughChanges(state.selectionEnd, changes));
    return {
        isTextReplacementRequired: true,
        replaceStart,
        replaceEnd,
        text,
        selectionStart: Math.min(mappedSelectionStart, mappedSelectionEnd),
        selectionEnd: Math.max(mappedSelectionStart, mappedSelectionEnd),
        selectionDirection: state.selectionDirection
    };
};

const createFenceStyleChange = (
    state: EditorState,
    lines: readonly DocumentLine[],
    block: FencedCodeBlock,
    targetStyle: Exclude<ConcreteBlockStyle, "codeBlock">,
    bulletStyle: BulletStyle,
    selectedLineIndexes: readonly number[]
): TextChange => {
    const contentLines = lines.slice(block.startLine + 1, block.endLine);
    const isContentBlank = contentLines.every((line) => /^[ \t]*$/.test(line.text));
    const shouldInsertEmptyFenceMarker =
        targetStyle !== "text" && isContentBlank && state.selectionStart === state.selectionEnd;
    const markerLineIndex =
        selectedLineIndexes.find((lineIndex) => lineIndex > block.startLine && lineIndex < block.endLine) ??
        block.startLine + 1;
    const innerChanges: TextChange[] = [];

    if (targetStyle !== "text") {
        for (const [index, line] of contentLines.entries()) {
            const change = createLineStyleChange(
                line,
                targetStyle,
                bulletStyle,
                shouldInsertEmptyFenceMarker && block.startLine + 1 + index === markerLineIndex
            );
            if (change) {
                innerChanges.push(change);
            }
        }
    }

    let text = createChangedText(state.value, block.contentStart, block.contentEnd, innerChanges);
    let blankMarkerCursor: number | null = null;
    if (shouldInsertEmptyFenceMarker) {
        if (contentLines.length === 0) {
            const prefix = getBlockPrefix(targetStyle, bulletStyle);
            const closerLine = lines[block.endLine];
            const followingLineEnding = state.value.slice(closerLine.contentEnd, closerLine.breakEnd);
            text = `${prefix}${followingLineEnding}`;
            blankMarkerCursor = prefix.length;
        } else {
            blankMarkerCursor =
                mapPositionThroughChanges(lines[markerLineIndex].start, innerChanges) - block.contentStart;
        }
    }

    return {
        start: lines[block.startLine].start,
        end: lines[block.endLine].breakEnd,
        text,
        mapPosition: (position) => {
            if (blankMarkerCursor !== null && (position < block.contentStart || position >= block.contentEnd)) {
                return blankMarkerCursor;
            }
            if (position < block.contentStart) {
                return 0;
            }
            if (position >= block.contentEnd) {
                return text.length;
            }
            return mapPositionThroughChanges(position, innerChanges) - block.contentStart;
        }
    };
};

const getExpandedLineRange = (
    selectedLineIndexes: readonly number[],
    blocks: readonly FencedCodeBlock[]
): { readonly startLine: number; readonly endLine: number } => {
    let startLine = selectedLineIndexes[0] ?? 0;
    let endLine = selectedLineIndexes.at(-1) ?? startLine;
    for (const block of blocks) {
        if (block.startLine <= endLine && block.endLine >= startLine) {
            startLine = Math.min(startLine, block.startLine);
            endLine = Math.max(endLine, block.endLine);
        }
    }
    return { startLine, endLine };
};

const applyLineBlockStyle = (
    state: EditorState,
    targetStyle: Exclude<ConcreteBlockStyle, "codeBlock">,
    bulletStyle: BulletStyle,
    lines: readonly DocumentLine[],
    blocks: readonly FencedCodeBlock[],
    selectedLineIndexes: readonly number[]
): EditOperation | null => {
    const range = getExpandedLineRange(selectedLineIndexes, blocks);
    const blocksByStartLine = new Map(blocks.map((block) => [block.startLine, block]));
    const fenceIdsByLine = createFenceIdsByLine(blocks);
    const changes: TextChange[] = [];

    for (let lineIndex = range.startLine; lineIndex <= range.endLine; lineIndex += 1) {
        const block = blocksByStartLine.get(lineIndex);
        if (block) {
            changes.push(createFenceStyleChange(state, lines, block, targetStyle, bulletStyle, selectedLineIndexes));
            lineIndex = block.endLine;
            continue;
        }
        if (fenceIdsByLine.has(lineIndex)) {
            continue;
        }

        const line = lines[lineIndex];
        const shouldStyleCollapsedBlankLine =
            state.selectionStart === state.selectionEnd && range.startLine === range.endLine;
        const change = createLineStyleChange(line, targetStyle, bulletStyle, shouldStyleCollapsedBlankLine);
        if (change) {
            changes.push(change);
        }
    }

    return createEditOperation(state, changes);
};

const getMaximumBacktickRun = (text: string): number =>
    Math.max(0, ...(text.match(/`+/g)?.map((run) => run.length) ?? []));

const getLineEndingAt = (value: string, index: number): "\n" | "\r\n" | null => {
    if (value.slice(index, index + 2) === "\r\n") {
        return "\r\n";
    }
    return value[index] === "\n" ? "\n" : null;
};

const getPreferredLineEnding = (state: EditorState, start: number, end: number): "\n" | "\r\n" => {
    const selectedLineFeed = state.value.indexOf("\n", start);
    if (selectedLineFeed >= 0 && selectedLineFeed < end) {
        return state.value[selectedLineFeed - 1] === "\r" ? "\r\n" : "\n";
    }

    const followingEnding = getLineEndingAt(state.value, end);
    if (followingEnding) {
        return followingEnding;
    }

    const previousLineFeed = state.value.lastIndexOf("\n", start - 1);
    return previousLineFeed >= 0 && state.value[previousLineFeed - 1] === "\r" ? "\r\n" : "\n";
};

const isSelectionInSingleFence = (
    state: EditorState,
    lines: readonly DocumentLine[],
    blocks: readonly FencedCodeBlock[],
    selectedLineIndexes: readonly number[]
): boolean => {
    if (getActiveBlockStyleFromParsedDocument(state, lines, blocks) !== "codeBlock") {
        return false;
    }
    const fenceIdsByLine = createFenceIdsByLine(blocks);
    const fenceIds = new Set(
        selectedLineIndexes.flatMap((lineIndex) => {
            const fenceId = fenceIdsByLine.get(lineIndex);
            return fenceId === undefined ? [] : [fenceId];
        })
    );
    return fenceIds.size === 1;
};

const applyCodeBlockStyle = (
    state: EditorState,
    lines: readonly DocumentLine[],
    blocks: readonly FencedCodeBlock[],
    selectedLineIndexes: readonly number[]
): EditOperation | null => {
    if (isSelectionInSingleFence(state, lines, blocks, selectedLineIndexes)) {
        return null;
    }

    const range = getExpandedLineRange(selectedLineIndexes, blocks);
    const start = lines[range.startLine].start;
    const end = lines[range.endLine].contentEnd;
    const content = state.value.slice(start, end);
    const fence = "`".repeat(Math.max(3, getMaximumBacktickRun(content) + 1));
    const lineEnding = getPreferredLineEnding(state, start, end);
    const openingLength = fence.length + lineEnding.length;
    const text = `${fence}${lineEnding}${content}${lineEnding}${fence}`;
    const change: TextChange = {
        start,
        end,
        mapEnd: lines[range.endLine].breakEnd,
        text,
        mapPosition: (position) => openingLength + Math.min(Math.max(position - start, 0), content.length)
    };
    return createEditOperation(state, [change]);
};

export const applyBlockStyle = (
    state: EditorState,
    targetStyle: ConcreteBlockStyle,
    bulletStyle: BulletStyle = "-"
): EditOperation | null => {
    const lines = parseDocumentLines(state.value);
    const blocks = findFencedCodeBlocks(lines);
    const selectedLineIndexes = getLineIndexes(state, lines);
    const activeStyle = getActiveBlockStyleFromParsedDocument(state, lines, blocks);

    if (targetStyle !== "codeBlock" && activeStyle === targetStyle) {
        return null;
    }
    if (targetStyle === "codeBlock") {
        return applyCodeBlockStyle(state, lines, blocks, selectedLineIndexes);
    }
    return applyLineBlockStyle(state, targetStyle, bulletStyle, lines, blocks, selectedLineIndexes);
};
