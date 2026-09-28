import type { EditOperation, EditorState } from "./editor-state";
import { getSelectedLineRange } from "./line-ranges";

export type LinePrefixKind =
    | "heading1"
    | "heading2"
    | "heading3"
    | "heading4"
    | "heading5"
    | "heading6"
    | "blockquote"
    | "bulletList"
    | "numberedList"
    | "taskList";

interface LinePrefixDefinition {
    readonly prefix: string;
    readonly targetPattern: RegExp;
    readonly competingPattern: RegExp;
}

interface LinePrefixChange {
    readonly transformedLine: string;
    readonly prefixStart: number;
    readonly removedLength: number;
    readonly insertedLength: number;
}

const LIST_PREFIX_PATTERN = /^(?:[-+*] \[[ xX]\] |[-+*] |\d+[.)] )/;

const createHeadingDefinition = (level: number): LinePrefixDefinition => ({
    prefix: `${"#".repeat(level)} `,
    targetPattern: new RegExp(`^#{${level}} `),
    competingPattern: /^#{1,6} /
});

const LINE_PREFIX_DEFINITIONS: Readonly<Record<LinePrefixKind, LinePrefixDefinition>> = {
    heading1: createHeadingDefinition(1),
    heading2: createHeadingDefinition(2),
    heading3: createHeadingDefinition(3),
    heading4: createHeadingDefinition(4),
    heading5: createHeadingDefinition(5),
    heading6: createHeadingDefinition(6),
    blockquote: { prefix: "> ", targetPattern: /^> /, competingPattern: /^> / },
    bulletList: {
        prefix: "- ",
        targetPattern: /^[-+*] (?!\[[ xX]\] )/,
        competingPattern: LIST_PREFIX_PATTERN
    },
    numberedList: {
        prefix: "1. ",
        targetPattern: /^\d+[.)] /,
        competingPattern: LIST_PREFIX_PATTERN
    },
    taskList: {
        prefix: "- [ ] ",
        targetPattern: /^[-+*] \[[ xX]\] /,
        competingPattern: LIST_PREFIX_PATTERN
    }
};

const getIndentationLength = (line: string): number => line.match(/^[ \t]*/)?.[0].length ?? 0;

const getMatchedPrefixLength = (content: string, pattern: RegExp): number => content.match(pattern)?.[0].length ?? 0;

const createLinePrefixChange = (
    line: string,
    lineStart: number,
    definition: LinePrefixDefinition,
    isRemovingPrefixes: boolean
): LinePrefixChange => {
    const indentationLength = getIndentationLength(line);
    const indentation = line.slice(0, indentationLength);
    const content = line.slice(indentationLength);
    const isBlankLine = content.trim() === "";
    const targetLength = getMatchedPrefixLength(content, definition.targetPattern);
    if (isBlankLine || (!isRemovingPrefixes && targetLength > 0)) {
        return {
            transformedLine: line,
            prefixStart: lineStart + indentationLength,
            removedLength: 0,
            insertedLength: 0
        };
    }

    const removedLength = isRemovingPrefixes
        ? targetLength
        : getMatchedPrefixLength(content, definition.competingPattern);
    const prefix = isRemovingPrefixes ? "" : definition.prefix;
    return {
        transformedLine: indentation + prefix + content.slice(removedLength),
        prefixStart: lineStart + indentationLength,
        removedLength,
        insertedLength: prefix.length
    };
};

const mapPositionAfterLinePrefixChanges = (position: number, changes: readonly LinePrefixChange[]): number => {
    let accumulatedDelta = 0;
    for (const change of changes) {
        if (position < change.prefixStart) {
            break;
        }
        if (position <= change.prefixStart + change.removedLength) {
            return change.prefixStart + accumulatedDelta + change.insertedLength;
        }
        accumulatedDelta += change.insertedLength - change.removedLength;
    }
    return position + accumulatedDelta;
};

export const toggleLinePrefix = (state: EditorState, kind: LinePrefixKind): EditOperation | null => {
    const definition = LINE_PREFIX_DEFINITIONS[kind];
    const range = getSelectedLineRange(state);
    const nonBlankLines = range.lines.filter((line) => line.trim() !== "");
    const isRemovingPrefixes =
        nonBlankLines.length > 0 &&
        nonBlankLines.every((line) => {
            const content = line.slice(getIndentationLength(line));
            return getMatchedPrefixLength(content, definition.targetPattern) > 0;
        });
    const changes = range.lines.map((line, index) =>
        createLinePrefixChange(line, range.lineStarts[index], definition, isRemovingPrefixes)
    );
    const text = changes.map(({ transformedLine }) => transformedLine).join("\n");
    const isTextChanged = text !== state.value.slice(range.replaceStart, range.replaceEnd);
    if (!isTextChanged) {
        return null;
    }

    return {
        isTextReplacementRequired: true,
        replaceStart: range.replaceStart,
        replaceEnd: range.replaceEnd,
        text,
        selectionStart: mapPositionAfterLinePrefixChanges(state.selectionStart, changes),
        selectionEnd: mapPositionAfterLinePrefixChanges(state.selectionEnd, changes),
        selectionDirection: state.selectionDirection
    };
};
