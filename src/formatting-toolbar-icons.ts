import caretDownIconRaw from "../assets/phosphor-icons/bold/caret-down-bold.svg?raw";
import codeBlockIconRaw from "../assets/phosphor-icons/bold/code-block-bold.svg?raw";
import codeIconRaw from "../assets/phosphor-icons/bold/code-bold.svg?raw";
import commandIconRaw from "../assets/phosphor-icons/bold/command-bold.svg?raw";
import dotsThreeIconRaw from "../assets/phosphor-icons/bold/dots-three-bold.svg?raw";
import linkIconRaw from "../assets/phosphor-icons/bold/link-bold.svg?raw";
import listBulletsIconRaw from "../assets/phosphor-icons/bold/list-bullets-bold.svg?raw";
import listChecksIconRaw from "../assets/phosphor-icons/bold/list-checks-bold.svg?raw";
import listNumbersIconRaw from "../assets/phosphor-icons/bold/list-numbers-bold.svg?raw";
import quotesIconRaw from "../assets/phosphor-icons/bold/quotes-bold.svg?raw";
import selectionIconRaw from "../assets/phosphor-icons/bold/selection-bold.svg?raw";
import textBoldIconRaw from "../assets/phosphor-icons/bold/text-b-bold.svg?raw";
import textHeadingFiveIconRaw from "../assets/phosphor-icons/bold/text-h-five-bold.svg?raw";
import textHeadingFourIconRaw from "../assets/phosphor-icons/bold/text-h-four-bold.svg?raw";
import textHeadingOneIconRaw from "../assets/phosphor-icons/bold/text-h-one-bold.svg?raw";
import textHeadingSixIconRaw from "../assets/phosphor-icons/bold/text-h-six-bold.svg?raw";
import textHeadingThreeIconRaw from "../assets/phosphor-icons/bold/text-h-three-bold.svg?raw";
import textHeadingTwoIconRaw from "../assets/phosphor-icons/bold/text-h-two-bold.svg?raw";
import textItalicIconRaw from "../assets/phosphor-icons/bold/text-italic-bold.svg?raw";
import textStrikethroughIconRaw from "../assets/phosphor-icons/bold/text-strikethrough-bold.svg?raw";
import textTIconRaw from "../assets/phosphor-icons/bold/text-t-bold.svg?raw";
import type { ConcreteBlockStyle } from "./block-styles";
import { EDITOR_COMMAND_IDS } from "./command-registry";

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";

export const TOOLBAR_ICON_CLASS = "tampermonkey-markdown-enhancer-formatting-toolbar__icon";

const COMMAND_ICON_RAW_BY_ID: ReadonlyMap<string, string> = new Map([
    [EDITOR_COMMAND_IDS.bold, textBoldIconRaw],
    [EDITOR_COMMAND_IDS.italic, textItalicIconRaw],
    [EDITOR_COMMAND_IDS.strikethrough, textStrikethroughIconRaw],
    [EDITOR_COMMAND_IDS.inlineCode, codeIconRaw],
    [EDITOR_COMMAND_IDS.link, linkIconRaw],
    [EDITOR_COMMAND_IDS.text, textTIconRaw],
    [EDITOR_COMMAND_IDS.codeBlock, codeBlockIconRaw],
    [EDITOR_COMMAND_IDS.heading1, textHeadingOneIconRaw],
    [EDITOR_COMMAND_IDS.heading2, textHeadingTwoIconRaw],
    [EDITOR_COMMAND_IDS.heading3, textHeadingThreeIconRaw],
    [EDITOR_COMMAND_IDS.heading4, textHeadingFourIconRaw],
    [EDITOR_COMMAND_IDS.heading5, textHeadingFiveIconRaw],
    [EDITOR_COMMAND_IDS.heading6, textHeadingSixIconRaw],
    [EDITOR_COMMAND_IDS.blockquote, quotesIconRaw],
    [EDITOR_COMMAND_IDS.bulletList, listBulletsIconRaw],
    [EDITOR_COMMAND_IDS.numberedList, listNumbersIconRaw],
    [EDITOR_COMMAND_IDS.taskList, listChecksIconRaw]
]);

const BLOCK_STYLE_ICON_RAW_BY_STYLE: ReadonlyMap<ConcreteBlockStyle, string> = new Map([
    ["text", textTIconRaw],
    ["heading1", textHeadingOneIconRaw],
    ["heading2", textHeadingTwoIconRaw],
    ["heading3", textHeadingThreeIconRaw],
    ["heading4", textHeadingFourIconRaw],
    ["heading5", textHeadingFiveIconRaw],
    ["heading6", textHeadingSixIconRaw],
    ["blockquote", quotesIconRaw],
    ["codeBlock", codeBlockIconRaw],
    ["bulletList", listBulletsIconRaw],
    ["numberedList", listNumbersIconRaw],
    ["taskList", listChecksIconRaw]
]);

const ALLOWED_SVG_ATTRIBUTES_BY_ELEMENT: ReadonlyMap<string, ReadonlySet<string>> = new Map([
    ["svg", new Set(["xmlns", "viewBox", "fill"])],
    ["path", new Set(["d"])]
]);

const parsedSvgTemplates = new Map<string, SVGSVGElement | null>();

const isTrustedSvgElement = (element: Element, root: Element): boolean => {
    const allowedAttributes = ALLOWED_SVG_ATTRIBUTES_BY_ELEMENT.get(element.localName);
    if (!allowedAttributes || element.namespaceURI !== SVG_NAMESPACE) {
        return false;
    }
    if (element !== root && (element.localName !== "path" || element.parentElement !== root)) {
        return false;
    }
    return Array.from(element.attributes).every((attribute) => allowedAttributes.has(attribute.name));
};

const PATH_PARAMETER_COUNTS: Readonly<Record<string, number>> = {
    A: 7,
    C: 6,
    H: 1,
    L: 2,
    M: 2,
    Q: 4,
    S: 4,
    T: 2,
    V: 1
};
const PATH_COMMAND_PATTERN = /^[AaCcHhLlMmQqSsTtVvZz]$/;
const PATH_NUMBER_PATTERN = /^[-+]?(?:\d+\.?\d*|\.\d+)(?:[Ee][-+]?\d+)?/;
const PATH_WHITESPACE_PATTERN = /[\t\n\r ]/;

const skipPathWhitespace = (pathData: string, initialOffset: number): number => {
    let offset = initialOffset;
    while (offset < pathData.length && PATH_WHITESPACE_PATTERN.test(pathData[offset])) {
        offset += 1;
    }
    return offset;
};

const preparePathParameter = (
    pathData: string,
    initialOffset: number,
    isFirstParameterAfterCommand: boolean
): number | null => {
    let offset = skipPathWhitespace(pathData, initialOffset);
    if (pathData[offset] !== ",") {
        return offset;
    }
    if (isFirstParameterAfterCommand) {
        return null;
    }
    offset = skipPathWhitespace(pathData, offset + 1);
    return pathData[offset] === "," || offset >= pathData.length ? null : offset;
};

const parsePathNumber = (
    pathData: string,
    offset: number
): { readonly end: number; readonly source: string; readonly value: number } | null => {
    const match = PATH_NUMBER_PATTERN.exec(pathData.slice(offset));
    if (!match) {
        return null;
    }
    const source = match[0];
    const value = Number(source);
    return Number.isFinite(value) ? { end: offset + source.length, source, value } : null;
};

const isValidPathData = (pathData: string): boolean => {
    if (!pathData.trim()) {
        return false;
    }
    let offset = skipPathWhitespace(pathData, 0);
    let isFirstCommand = true;
    while (offset < pathData.length) {
        const command = pathData[offset];
        if (!PATH_COMMAND_PATTERN.test(command) || (isFirstCommand && !/^[Mm]$/.test(command))) {
            return false;
        }
        isFirstCommand = false;
        offset += 1;
        if (/^[Zz]$/.test(command)) {
            offset = skipPathWhitespace(pathData, offset);
            continue;
        }
        const parameterCount = PATH_PARAMETER_COUNTS[command.toUpperCase()];
        let groupCount = 0;
        while (offset < pathData.length) {
            for (let parameterIndex = 0; parameterIndex < parameterCount; parameterIndex += 1) {
                const parameterOffset = preparePathParameter(
                    pathData,
                    offset,
                    groupCount === 0 && parameterIndex === 0
                );
                if (parameterOffset === null) {
                    return false;
                }
                const isArcFlag = command.toUpperCase() === "A" && (parameterIndex === 3 || parameterIndex === 4);
                if (isArcFlag) {
                    if (pathData[parameterOffset] !== "0" && pathData[parameterOffset] !== "1") {
                        return false;
                    }
                    offset = parameterOffset + 1;
                    continue;
                }
                const number = parsePathNumber(pathData, parameterOffset);
                const isArcRadius = command.toUpperCase() === "A" && parameterIndex < 2;
                if (!number || (isArcRadius && (number.value < 0 || /^[+-]/.test(number.source)))) {
                    return false;
                }
                offset = number.end;
            }
            groupCount += 1;
            const nextOffset = skipPathWhitespace(pathData, offset);
            if (nextOffset >= pathData.length || PATH_COMMAND_PATTERN.test(pathData[nextOffset])) {
                offset = nextOffset;
                break;
            }
        }
        if (groupCount === 0) {
            return false;
        }
    }
    return !isFirstCommand;
};

const hasExactSvgViewBox = (rawSvg: string): boolean => {
    const openingTag = /^\s*<svg\b[^>]*>/.exec(rawSvg)?.[0];
    return openingTag ? /(?:^|\s)viewBox\s*=\s*(["'])0 0 256 256\1(?=\s|\/?$|>)/.test(openingTag) : false;
};

const isWhitespaceTextNode = (node: Node): boolean => node.nodeType === Node.TEXT_NODE && !node.textContent?.trim();

const hasTrustedSvgStructure = (parsedDocument: Document, root: Element): boolean =>
    Array.from(parsedDocument.childNodes).every((node) => node === root || isWhitespaceTextNode(node)) &&
    Array.from(root.childNodes).every(
        (node) =>
            isWhitespaceTextNode(node) ||
            (node instanceof Element &&
                node.localName === "path" &&
                node.parentElement === root &&
                Array.from(node.childNodes).every(isWhitespaceTextNode))
    );

const parseTrustedSvg = (rawSvg: string): SVGSVGElement | null => {
    const cachedTemplate = parsedSvgTemplates.get(rawSvg);
    if (cachedTemplate !== undefined) {
        return cachedTemplate;
    }

    const parsedDocument = new DOMParser().parseFromString(rawSvg, "image/svg+xml");
    const root = parsedDocument.documentElement;
    const elements = [root, ...Array.from(root.querySelectorAll("*"))];
    const directPaths = Array.from(root.children);
    const isTrusted =
        !parsedDocument.doctype &&
        !parsedDocument.querySelector("parsererror") &&
        root.localName === "svg" &&
        root.namespaceURI === SVG_NAMESPACE &&
        root.getAttribute("xmlns") === SVG_NAMESPACE &&
        root.getAttribute("fill") === "currentColor" &&
        hasExactSvgViewBox(rawSvg) &&
        root.getAttribute("viewBox") === "0 0 256 256" &&
        hasTrustedSvgStructure(parsedDocument, root) &&
        !root.textContent?.trim() &&
        directPaths.length > 0 &&
        directPaths.every(
            (element) => element.localName === "path" && isValidPathData(element.getAttribute("d") ?? "")
        ) &&
        elements.every((element) => isTrustedSvgElement(element, root));
    const template = isTrusted ? (root as unknown as SVGSVGElement) : null;
    parsedSvgTemplates.set(rawSvg, template);
    return template;
};

const commandIconTemplate = parseTrustedSvg(commandIconRaw);

const createToolbarIconElement = (template: SVGSVGElement | null): SVGSVGElement => {
    const icon = template
        ? (document.importNode(template, true) as SVGSVGElement)
        : document.createElementNS(SVG_NAMESPACE, "svg");
    icon.classList.add(TOOLBAR_ICON_CLASS);
    icon.setAttribute("aria-hidden", "true");
    icon.setAttribute("focusable", "false");
    icon.setAttribute("fill", "currentColor");
    icon.setAttribute("height", "16");
    icon.setAttribute("width", "16");
    return icon;
};

export const createToolbarIconFromRawSvg = (rawSvg: string): SVGSVGElement =>
    createToolbarIconElement(parseTrustedSvg(rawSvg) ?? commandIconTemplate);

export const createToolbarCommandIcon = (commandId: string): SVGSVGElement =>
    createToolbarIconFromRawSvg(COMMAND_ICON_RAW_BY_ID.get(commandId) ?? commandIconRaw);

export const createToolbarBlockStyleIcon = (blockStyle: ConcreteBlockStyle): SVGSVGElement =>
    createToolbarIconFromRawSvg(BLOCK_STYLE_ICON_RAW_BY_STYLE.get(blockStyle) ?? commandIconRaw);

export const createToolbarTextIcon = (): SVGSVGElement => createToolbarIconFromRawSvg(textTIconRaw);

export const createToolbarMixedIcon = (): SVGSVGElement => createToolbarIconFromRawSvg(selectionIconRaw);

export const createToolbarCaretDownIcon = (): SVGSVGElement => createToolbarIconFromRawSvg(caretDownIconRaw);

export const createToolbarMoreIcon = (): SVGSVGElement => createToolbarIconFromRawSvg(dotsThreeIconRaw);
