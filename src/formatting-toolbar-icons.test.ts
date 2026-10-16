import { describe, expect, test, vi } from "vitest";
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
import {
    createToolbarCommandIcon,
    createToolbarIconFromRawSvg,
    createToolbarMoreIcon,
    TOOLBAR_ICON_CLASS
} from "./formatting-toolbar-icons";

const CORE_ICON_CASES: ReadonlyArray<readonly [string, string]> = [
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
];

const parseExpectedSvg = (rawSvg: string): SVGSVGElement =>
    new DOMParser().parseFromString(rawSvg, "image/svg+xml").documentElement as unknown as SVGSVGElement;

const serializeSvgChildren = (icon: SVGSVGElement): string[] =>
    Array.from(icon.children, (child) => new XMLSerializer().serializeToString(child));

const expectIconToMatchRawSvg = (icon: SVGSVGElement, rawSvg: string): void => {
    const expectedIcon = parseExpectedSvg(rawSvg);
    expect(icon.getAttribute("viewBox")).toBe(expectedIcon.getAttribute("viewBox"));
    expect(serializeSvgChildren(icon)).toEqual(serializeSvgChildren(expectedIcon));
};

describe("Formatting toolbar icons", () => {
    test.each(CORE_ICON_CASES)("maps %s to its exact local SVG", (commandId, rawSvg) => {
        expectIconToMatchRawSvg(createToolbarCommandIcon(commandId), rawSvg);
    });

    test.each(["contributed.command", "toString", "constructor", "__proto__"])(
        "uses the command icon for the arbitrary command ID %s",
        (commandId) => {
            const icon = createToolbarCommandIcon(commandId);

            expectIconToMatchRawSvg(icon, commandIconRaw);
            expect(icon.textContent).toBe("");
        }
    );

    test.each([
        ["parser errors", '<svg xmlns="http://www.w3.org/2000/svg"><path>'],
        ["scripts", '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1" fill="currentColor"><script/></svg>'],
        [
            "foreign objects",
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1" fill="currentColor"><foreignObject/></svg>'
        ],
        ["iframes", '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1" fill="currentColor"><iframe/></svg>'],
        ["objects", '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1" fill="currentColor"><object/></svg>'],
        ["embeds", '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1" fill="currentColor"><embed/></svg>'],
        ["images", '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1" fill="currentColor"><image/></svg>'],
        ["uses", '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1" fill="currentColor"><use/></svg>'],
        [
            "event attributes",
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1" fill="currentColor" onload="alert(1)"><path d="M0 0"/></svg>'
        ],
        [
            "href attributes",
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1" fill="currentColor"><path d="M0 0" href="https://example.com"/></svg>'
        ],
        [
            "xlink href attributes",
            '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 1 1" fill="currentColor"><path d="M0 0" xlink:href="https://example.com"/></svg>'
        ],
        [
            "src attributes",
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1" fill="currentColor"><path d="M0 0" src="https://example.com"/></svg>'
        ],
        [
            "style attributes",
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1" fill="currentColor"><path d="M0 0" style="fill:url(https://example.com)"/></svg>'
        ],
        [
            "URL-valued paint attributes",
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1" fill="url(https://example.com)"><path d="M0 0"/></svg>'
        ],
        [
            "titles",
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1" fill="currentColor"><title>Unsafe title</title></svg>'
        ],
        [
            "text",
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1" fill="currentColor"><text>Unsafe text</text></svg>'
        ]
    ])("uses the safe command fallback for %s", (_caseName, rawSvg) => {
        const icon = createToolbarIconFromRawSvg(rawSvg);

        expectIconToMatchRawSvg(icon, commandIconRaw);
        expect(icon.textContent).toBe("");
        expect(icon.querySelector("title, text")).toBeNull();
        expect(icon.querySelector("script, foreignObject, iframe, object, embed, image, use")).toBeNull();
        expect(icon.querySelector("[href], [src], [style], [onload]")).toBeNull();
        expect(icon.outerHTML).not.toContain("url(");
    });

    test("uses the dots-three icon for More", () => {
        expectIconToMatchRawSvg(createToolbarMoreIcon(), dotsThreeIconRaw);
    });

    test("returns fresh, presentation-only 16px current-color SVG elements", () => {
        const firstIcon = createToolbarCommandIcon(EDITOR_COMMAND_IDS.bold);
        const secondIcon = createToolbarCommandIcon(EDITOR_COMMAND_IDS.bold);

        expect(firstIcon).not.toBe(secondIcon);
        expect(firstIcon.firstElementChild).not.toBe(secondIcon.firstElementChild);
        expect(firstIcon.classList.contains(TOOLBAR_ICON_CLASS)).toBe(true);
        expect(firstIcon.getAttribute("aria-hidden")).toBe("true");
        expect(firstIcon.getAttribute("focusable")).toBe("false");
        expect(firstIcon.getAttribute("fill")).toBe("currentColor");
        expect(firstIcon.getAttribute("height")).toBe("16");
        expect(firstIcon.getAttribute("width")).toBe("16");
    });

    test("creates local inline SVG without runtime URL access", () => {
        const fetchRequest = vi.spyOn(globalThis, "fetch");
        const icons = [
            ...CORE_ICON_CASES.map(([commandId]) => createToolbarCommandIcon(commandId)),
            createToolbarMoreIcon()
        ];

        expect(fetchRequest).not.toHaveBeenCalled();
        for (const icon of icons) {
            expect(icon.localName).toBe("svg");
            expect(icon.querySelectorAll("[href], [src]")).toHaveLength(0);
            expect(icon.outerHTML).not.toContain("url(");
        }
        fetchRequest.mockRestore();
    });
});
