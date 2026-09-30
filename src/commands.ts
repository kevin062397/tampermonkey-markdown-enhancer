import { toggleFencedCodeBlock, toggleInlineCode } from "./code-formatting";
import { applyEditTransaction } from "./edit-transaction";
import { readEditorState, type EditorTransform } from "./editor-state";
import { toggleLinePrefix, type BulletStyle, type LinePrefixKind } from "./line-prefixes";
import { continueMarkdownLine, indentMarkdownLine } from "./markdown-lines";
import {
    createMarkdownLinkFromPaste,
    createMarkdownLinkFromSelection,
    deleteEmptyPair,
    indentSelectedLines,
    insertSpaces,
    outdentSelectedLines,
    skipClosingPair,
    toggleWrap,
    wrapSelection
} from "./transformations";

const executeTransform = (textArea: HTMLTextAreaElement, transform: EditorTransform): boolean => {
    const operation = transform(readEditorState(textArea));
    if (!operation) {
        return false;
    }
    applyEditTransaction(textArea, operation);
    return true;
};

export const skipClosingPairCommand = (textArea: HTMLTextAreaElement, character: string): boolean =>
    executeTransform(textArea, (state) => skipClosingPair(state, character));

export const deleteEmptyPairCommand = (textArea: HTMLTextAreaElement): boolean =>
    executeTransform(textArea, deleteEmptyPair);

export const wrapSelectionCommand = (textArea: HTMLTextAreaElement, leading: string, trailing: string): boolean =>
    executeTransform(textArea, (state) => wrapSelection(state, leading, trailing));

export const toggleWrapCommand = (textArea: HTMLTextAreaElement, wrap: string): boolean =>
    executeTransform(textArea, (state) => toggleWrap(state, wrap));

export const toggleInlineCodeCommand = (textArea: HTMLTextAreaElement): boolean =>
    executeTransform(textArea, toggleInlineCode);

export const toggleFencedCodeBlockCommand = (textArea: HTMLTextAreaElement): boolean =>
    executeTransform(textArea, toggleFencedCodeBlock);

export const toggleLinePrefixCommand = (
    textArea: HTMLTextAreaElement,
    kind: LinePrefixKind,
    bulletStyle: BulletStyle = "-"
): boolean => executeTransform(textArea, (state) => toggleLinePrefix(state, kind, bulletStyle));

export const continueMarkdownLineCommand = (textArea: HTMLTextAreaElement): boolean =>
    executeTransform(textArea, continueMarkdownLine);

export const indentMarkdownLineCommand = (textArea: HTMLTextAreaElement, tabSize: number): boolean =>
    executeTransform(textArea, (state) => indentMarkdownLine(state, tabSize));

export const indentCommand = (textArea: HTMLTextAreaElement, tabSize: number): boolean =>
    executeTransform(textArea, (state) => indentSelectedLines(state, tabSize));

export const insertSpacesCommand = (textArea: HTMLTextAreaElement, tabSize: number): boolean =>
    executeTransform(textArea, (state) => insertSpaces(state, tabSize));

export const outdentCommand = (textArea: HTMLTextAreaElement, tabSize: number): boolean =>
    executeTransform(textArea, (state) => outdentSelectedLines(state, tabSize));

export const insertMarkdownLinkCommand = (textArea: HTMLTextAreaElement): boolean =>
    executeTransform(textArea, createMarkdownLinkFromSelection);

export const pasteMarkdownLinkCommand = (textArea: HTMLTextAreaElement, pasteText: string): boolean =>
    executeTransform(textArea, (state) => createMarkdownLinkFromPaste(state, pasteText));
