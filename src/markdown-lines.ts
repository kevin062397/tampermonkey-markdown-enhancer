import type { EditOperation, EditorState } from "./editor-state";
import { indentSelectedLines } from "./transformations";

export type MarkdownLineKind = "blockquote" | "bullet" | "indented" | "numbered" | "task";

export interface MarkdownLine {
    readonly kind: MarkdownLineKind;
    readonly lineStart: number;
    readonly contentEnd: number;
    readonly markerStart: number;
    readonly contentStart: number;
    readonly indentation: string;
    readonly marker: string;
    readonly content: string;
    readonly bulletCharacter?: string;
    readonly orderedDelimiter?: string;
    readonly orderedNumber?: string;
}

const getCurrentLine = (state: EditorState): { lineStart: number; contentEnd: number; line: string } => {
    const lineStart = state.value.slice(0, state.selectionStart).lastIndexOf("\n") + 1;
    const nextLineBreak = state.value.indexOf("\n", state.selectionStart);
    const lineEnd = nextLineBreak >= 0 ? nextLineBreak : state.value.length;
    const isCarriageReturnPresent = state.value[lineEnd - 1] === "\r";
    const contentEnd = isCarriageReturnPresent ? lineEnd - 1 : lineEnd;
    return { lineStart, contentEnd, line: state.value.slice(lineStart, contentEnd) };
};

export const parseMarkdownLine = (state: EditorState): MarkdownLine | null => {
    const { lineStart, contentEnd, line } = getCurrentLine(state);
    const indentation = line.match(/^[ \t]*/)?.[0] ?? "";
    const body = line.slice(indentation.length);
    const markerStart = lineStart + indentation.length;

    const taskMatch = body.match(/^([-+*]) \[([ xX])\] /);
    if (taskMatch) {
        return {
            kind: "task",
            lineStart,
            contentEnd,
            markerStart,
            contentStart: markerStart + taskMatch[0].length,
            indentation,
            marker: taskMatch[0],
            content: body.slice(taskMatch[0].length),
            bulletCharacter: taskMatch[1]
        };
    }

    const numberedMatch = body.match(/^(\d+)([.)]) /);
    if (numberedMatch) {
        return {
            kind: "numbered",
            lineStart,
            contentEnd,
            markerStart,
            contentStart: markerStart + numberedMatch[0].length,
            indentation,
            marker: numberedMatch[0],
            content: body.slice(numberedMatch[0].length),
            orderedNumber: numberedMatch[1],
            orderedDelimiter: numberedMatch[2]
        };
    }

    const bulletMatch = body.match(/^([-+*]) /);
    if (bulletMatch) {
        return {
            kind: "bullet",
            lineStart,
            contentEnd,
            markerStart,
            contentStart: markerStart + bulletMatch[0].length,
            indentation,
            marker: bulletMatch[0],
            content: body.slice(bulletMatch[0].length),
            bulletCharacter: bulletMatch[1]
        };
    }

    const blockquoteMatch = body.match(/^(?:>[ \t]?)+/);
    if (blockquoteMatch) {
        return {
            kind: "blockquote",
            lineStart,
            contentEnd,
            markerStart,
            contentStart: markerStart + blockquoteMatch[0].length,
            indentation,
            marker: blockquoteMatch[0],
            content: body.slice(blockquoteMatch[0].length)
        };
    }

    if (indentation) {
        return {
            kind: "indented",
            lineStart,
            contentEnd,
            markerStart,
            contentStart: markerStart,
            indentation,
            marker: "",
            content: body
        };
    }
    return null;
};

const getNewlineSequence = (value: string, line: MarkdownLine): "\n" | "\r\n" => {
    if (value.slice(line.contentEnd, line.contentEnd + 2) === "\r\n") {
        return "\r\n";
    }
    if (value[line.contentEnd] === "\n") {
        return "\n";
    }
    return value.slice(Math.max(0, line.lineStart - 2), line.lineStart) === "\r\n" ? "\r\n" : "\n";
};

const incrementDecimalString = (value: string): string => {
    const digits = value.split("");
    let carry = 1;
    for (let index = digits.length - 1; index >= 0 && carry; index -= 1) {
        const nextDigit = Number(digits[index]) + carry;
        digits[index] = String(nextDigit % 10);
        carry = nextDigit >= 10 ? 1 : 0;
    }
    return (carry ? "1" : "") + digits.join("");
};

const getContinuationMarker = (line: MarkdownLine): string => {
    switch (line.kind) {
        case "task":
            return `${line.bulletCharacter} [ ] `;
        case "numbered":
            return `${incrementDecimalString(line.orderedNumber ?? "0")}${line.orderedDelimiter} `;
        default:
            return line.marker;
    }
};

export const continueMarkdownLine = (state: EditorState): EditOperation | null => {
    if (state.selectionStart !== state.selectionEnd) {
        return null;
    }
    const line = parseMarkdownLine(state);
    if (!line || state.selectionStart < line.contentStart) {
        return null;
    }

    const isContentEmpty = line.content.trim() === "";
    if (isContentEmpty) {
        const replaceStart = line.kind === "indented" ? line.lineStart : line.markerStart;
        return {
            isTextReplacementRequired: true,
            replaceStart,
            replaceEnd: line.contentEnd,
            text: "",
            selectionStart: replaceStart,
            selectionEnd: replaceStart,
            selectionDirection: "none"
        };
    }

    const text = getNewlineSequence(state.value, line) + line.indentation + getContinuationMarker(line);
    const cursor = state.selectionStart + text.length;
    return {
        isTextReplacementRequired: true,
        replaceStart: state.selectionStart,
        replaceEnd: state.selectionEnd,
        text,
        selectionStart: cursor,
        selectionEnd: cursor,
        selectionDirection: "none"
    };
};

export const indentMarkdownLine = (state: EditorState, tabSize: number): EditOperation | null => {
    if (state.selectionStart !== state.selectionEnd) {
        return null;
    }
    const line = parseMarkdownLine(state);
    if (!line || line.kind === "indented") {
        return null;
    }
    return indentSelectedLines(state, tabSize);
};
