import type { EditorState } from "./editor-state";
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
    readonly start: number;
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
}

const parseDocumentLines = (value: string): readonly DocumentLine[] => {
    const lines: DocumentLine[] = [];
    let start = 0;

    while (start <= value.length) {
        const lineFeed = value.indexOf("\n", start);
        const end = lineFeed >= 0 ? lineFeed : value.length;
        const contentEnd = value[end - 1] === "\r" ? end - 1 : end;
        lines.push({ start, text: value.slice(start, contentEnd) });
        if (lineFeed < 0) {
            break;
        }
        start = lineFeed + 1;
    }

    return lines;
};

const matchFenceOpener = (line: string): FenceOpener | null => {
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
        const opener = matchFenceOpener(lines[startLine].text);
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

        blocks.push({ id: blocks.length, startLine, endLine });
        startLine = endLine;
    }

    return blocks;
};

const getLineStyle = (line: string): ConcreteBlockStyle => {
    const body = line.replace(/^[ \t]*/, "");
    const heading = body.match(/^(#{1,6})(?:[ \t]|$)/);
    if (heading) {
        return `heading${heading[1].length}` as ConcreteBlockStyle;
    }
    if (body.startsWith(">")) {
        return "blockquote";
    }
    if (/^(?:\*(?:[ \t]*\*){2,}|-(?:[ \t]*-){2,}|_(?:[ \t]*_){2,})[ \t]*$/.test(body)) {
        return "text";
    }
    if (/^[-+*][ \t]+\[[ xX]\](?:[ \t]|$)/.test(body)) {
        return "taskList";
    }
    if (/^[-+*](?:[ \t]|$)/.test(body)) {
        return "bulletList";
    }
    if (/^\d+[.)](?:[ \t]|$)/.test(body)) {
        return "numberedList";
    }
    return "text";
};

export const getActiveBlockStyle = (state: EditorState): ActiveBlockStyle => {
    const selectedRange = getSelectedLineRange(state);
    const documentLines = parseDocumentLines(state.value);
    const lineIndexesByStart = new Map(documentLines.map((line, index) => [line.start, index]));
    const fenceIdsByLine = new Map<number, number>();

    for (const block of findFencedCodeBlocks(documentLines)) {
        for (let lineIndex = block.startLine; lineIndex <= block.endLine; lineIndex += 1) {
            fenceIdsByLine.set(lineIndex, block.id);
        }
    }

    let activeStyle: ConcreteBlockStyle | undefined;
    let activeFenceId: number | undefined;

    for (const lineStart of selectedRange.lineStarts) {
        const lineIndex = lineIndexesByStart.get(lineStart);
        if (lineIndex === undefined) {
            return "text";
        }

        const fenceId = fenceIdsByLine.get(lineIndex);
        const content = documentLines[lineIndex].text;
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
