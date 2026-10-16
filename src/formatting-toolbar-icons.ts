import codeBlockIconRaw from "../assets/phosphor-icons/bold/code-block-bold.svg?raw";
import codeIconRaw from "../assets/phosphor-icons/bold/code-bold.svg?raw";
import commandIconRaw from "../assets/phosphor-icons/bold/command-bold.svg?raw";
import dotsThreeIconRaw from "../assets/phosphor-icons/bold/dots-three-bold.svg?raw";
import linkIconRaw from "../assets/phosphor-icons/bold/link-bold.svg?raw";
import listBulletsIconRaw from "../assets/phosphor-icons/bold/list-bullets-bold.svg?raw";
import listChecksIconRaw from "../assets/phosphor-icons/bold/list-checks-bold.svg?raw";
import listNumbersIconRaw from "../assets/phosphor-icons/bold/list-numbers-bold.svg?raw";
import quotesIconRaw from "../assets/phosphor-icons/bold/quotes-bold.svg?raw";
import textBoldIconRaw from "../assets/phosphor-icons/bold/text-b-bold.svg?raw";
import textHeadingFiveIconRaw from "../assets/phosphor-icons/bold/text-h-five-bold.svg?raw";
import textHeadingFourIconRaw from "../assets/phosphor-icons/bold/text-h-four-bold.svg?raw";
import textHeadingOneIconRaw from "../assets/phosphor-icons/bold/text-h-one-bold.svg?raw";
import textHeadingSixIconRaw from "../assets/phosphor-icons/bold/text-h-six-bold.svg?raw";
import textHeadingThreeIconRaw from "../assets/phosphor-icons/bold/text-h-three-bold.svg?raw";
import textHeadingTwoIconRaw from "../assets/phosphor-icons/bold/text-h-two-bold.svg?raw";
import textItalicIconRaw from "../assets/phosphor-icons/bold/text-italic-bold.svg?raw";
import textStrikethroughIconRaw from "../assets/phosphor-icons/bold/text-strikethrough-bold.svg?raw";
import { EDITOR_COMMAND_IDS } from "./command-registry";

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";

export const TOOLBAR_ICON_CLASS = "tampermonkey-markdown-enhancer-formatting-toolbar__icon";

const COMMAND_ICON_RAW_BY_ID: ReadonlyMap<string, string> = new Map([
    [EDITOR_COMMAND_IDS.bold, textBoldIconRaw],
    [EDITOR_COMMAND_IDS.italic, textItalicIconRaw],
    [EDITOR_COMMAND_IDS.strikethrough, textStrikethroughIconRaw],
    [EDITOR_COMMAND_IDS.inlineCode, codeIconRaw],
    [EDITOR_COMMAND_IDS.link, linkIconRaw],
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

const parseTrustedSvg = (rawSvg: string): SVGSVGElement | null => {
    const cachedTemplate = parsedSvgTemplates.get(rawSvg);
    if (cachedTemplate !== undefined) {
        return cachedTemplate;
    }

    const parsedDocument = new DOMParser().parseFromString(rawSvg, "image/svg+xml");
    const root = parsedDocument.documentElement;
    const elements = [root, ...Array.from(root.querySelectorAll("*"))];
    const isTrusted =
        !parsedDocument.doctype &&
        !parsedDocument.querySelector("parsererror") &&
        root.localName === "svg" &&
        root.namespaceURI === SVG_NAMESPACE &&
        root.getAttribute("xmlns") === SVG_NAMESPACE &&
        root.getAttribute("fill") === "currentColor" &&
        root.hasAttribute("viewBox") &&
        !root.textContent?.trim() &&
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

export const createToolbarMoreIcon = (): SVGSVGElement => createToolbarIconFromRawSvg(dotsThreeIconRaw);
