import { afterEach, describe, expect, test, vi } from "vitest";
import {
    collectColorSchemeSignalElements,
    collectColorSchemeSignals,
    collectColorSchemeSlotRoots,
    COLOR_SCHEME_MEDIA_QUERY,
    COLOR_SCHEME_SIGNAL_ATTRIBUTES,
    isColorSchemeSignalAttribute,
    isColorSchemeSignalElement,
    readColorSchemeMediaQuery,
    resolveActiveColorScheme,
    type ColorSchemeSignals
} from "./color-scheme";

const createSignals = (overrides: Partial<ColorSchemeSignals> = {}): ColorSchemeSignals => ({
    computedColorScheme: "normal",
    isDarkMediaMatched: false,
    themeValuesByElement: [],
    ...overrides
});

const createMediaQueryList = (isMatched: boolean): MediaQueryList =>
    ({
        addEventListener: vi.fn(),
        addListener: vi.fn(),
        dispatchEvent: vi.fn(),
        matches: isMatched,
        media: COLOR_SCHEME_MEDIA_QUERY,
        onchange: null,
        removeEventListener: vi.fn(),
        removeListener: vi.fn()
    }) as unknown as MediaQueryList;

afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
});

describe("Color scheme resolution", () => {
    test.each([
        ["dark", "dark"],
        ["DARK", "dark"],
        ["only dark", "dark"],
        ["dark only", "dark"],
        ["\t ONLY \n DARK \r", "dark"],
        ["light", "light"],
        ["LIGHT", "light"],
        ["only light", "light"],
        ["light only", "light"],
        ["\f LIGHT   ONLY ", "light"]
    ] as const)("normalizes the recognized computed color-scheme %j", (computedColorScheme, expectedScheme) => {
        expect(
            resolveActiveColorScheme(
                createSignals({
                    computedColorScheme,
                    isDarkMediaMatched: expectedScheme === "light",
                    themeValuesByElement: [[expectedScheme === "dark" ? "light" : "dark"]]
                })
            )
        ).toBe(expectedScheme);
    });

    test.each(["", "normal", "only", "custom"])(
        "treats computed color-scheme %j as inconclusive",
        (computedColorScheme) => {
            expect(
                resolveActiveColorScheme(createSignals({ computedColorScheme, themeValuesByElement: [["dark"]] }))
            ).toBe("dark");
        }
    );

    test.each([
        ["light dark", "dark"],
        ["dark light", "light"]
    ] as const)("rejects ambiguous computed color-scheme %j", (computedColorScheme, outerScheme) => {
        expect(
            resolveActiveColorScheme(createSignals({ computedColorScheme, themeValuesByElement: [[outerScheme]] }))
        ).toBe(outerScheme);
    });

    test.each([
        ["dark\u00a0", "light"],
        ["\u00a0dark", "light"],
        ["dark\ufeff", "light"],
        ["\ufeffdark", "light"],
        ["light\u00a0", "dark"],
        ["\u00a0light", "dark"],
        ["light\ufeff", "dark"],
        ["\ufefflight", "dark"]
    ] as const)("rejects non-ASCII computed boundary value %j", (computedColorScheme, outerScheme) => {
        expect(
            resolveActiveColorScheme(createSignals({ computedColorScheme, themeValuesByElement: [[outerScheme]] }))
        ).toBe(outerScheme);
    });

    test("normalizes ASCII case and whitespace for approved theme attributes", () => {
        expect(resolveActiveColorScheme(createSignals({ themeValuesByElement: [[" \t LiGhT \n "]] }))).toBe("light");
        expect(resolveActiveColorScheme(createSignals({ themeValuesByElement: [[" \r DARK \f "]] }))).toBe("dark");
    });

    test("continues outward when one element has conflicting recognized theme attributes", () => {
        expect(
            resolveActiveColorScheme(createSignals({ themeValuesByElement: [["DARK", " light "], ["light"]] }))
        ).toBe("light");
        expect(resolveActiveColorScheme(createSignals({ themeValuesByElement: [["light", " DARK "], ["dark"]] }))).toBe(
            "dark"
        );
    });

    test("accepts repeated matching theme attributes on the same element", () => {
        expect(
            resolveActiveColorScheme(
                createSignals({ themeValuesByElement: [[" DARK ", "dark"]], isDarkMediaMatched: false })
            )
        ).toBe("dark");
    });

    test.each([
        ["\u00a0dark", "light"],
        ["dark\u00a0", "light"],
        ["\ufeffdark", "light"],
        ["dark\ufeff", "light"],
        ["\u00a0light", "dark"],
        ["light\u00a0", "dark"],
        ["\ufefflight", "dark"],
        ["light\ufeff", "dark"]
    ] as const)("rejects non-ASCII theme boundary value %j", (themeValue, outerScheme) => {
        expect(resolveActiveColorScheme(createSignals({ themeValuesByElement: [[themeValue], [outerScheme]] }))).toBe(
            outerScheme
        );
    });

    test.each([
        ["auto", "dark"],
        ["light dark", "dark"],
        ["dark light", "light"],
        ["dark only", "light"],
        ["only dark", "light"],
        ["light only", "dark"],
        ["only light", "dark"]
    ] as const)("skips non-exact theme value %j before using an outer scope", (themeValue, outerScheme) => {
        expect(resolveActiveColorScheme(createSignals({ themeValuesByElement: [[themeValue], [outerScheme]] }))).toBe(
            outerScheme
        );
    });

    test("uses owner-window media preference and defaults to light", () => {
        expect(resolveActiveColorScheme(createSignals({ isDarkMediaMatched: true }))).toBe("dark");
        expect(resolveActiveColorScheme(createSignals())).toBe("light");
    });
});

describe("Color scheme signal collection", () => {
    test("collects the textarea before ordered ancestor attributes and owner-window media state", () => {
        const outer = document.createElement("section");
        outer.dataset.theme = "dark";
        const inner = document.createElement("div");
        inner.dataset.colorMode = "LIGHT";
        inner.dataset.bsTheme = "dark";
        const textArea = document.createElement("textarea");
        textArea.dataset.theme = " light ";
        inner.append(textArea);
        outer.append(inner);
        document.body.append(outer);
        const mediaQueryList = createMediaQueryList(true);
        vi.spyOn(window, "getComputedStyle").mockReturnValue({ colorScheme: "normal" } as CSSStyleDeclaration);

        expect(collectColorSchemeSignals(textArea, mediaQueryList)).toEqual({
            computedColorScheme: "normal",
            isDarkMediaMatched: true,
            themeValuesByElement: [[" light "], ["LIGHT", "dark"], ["dark"]]
        });
    });

    test("walks nearest ancestors and open ShadowRoot hosts in composed order", () => {
        const outerHost = document.createElement("article");
        outerHost.dataset.theme = "light";
        const outerRoot = outerHost.attachShadow({ mode: "open" });
        const innerHost = document.createElement("section");
        innerHost.dataset.colorMode = "dark";
        const innerRoot = innerHost.attachShadow({ mode: "open" });
        const scope = document.createElement("div");
        scope.dataset.bsTheme = "LIGHT";
        const textArea = document.createElement("textarea");
        scope.append(textArea);
        innerRoot.append(scope);
        outerRoot.append(innerHost);
        document.body.append(outerHost);
        vi.spyOn(window, "getComputedStyle").mockReturnValue({ colorScheme: "normal" } as CSSStyleDeclaration);

        const signals = collectColorSchemeSignals(textArea, createMediaQueryList(false));

        expect(signals.themeValuesByElement).toEqual([["LIGHT"], ["dark"], ["light"]]);
        expect(resolveActiveColorScheme(signals)).toBe("light");
        expect(isColorSchemeSignalElement(textArea, textArea)).toBe(true);
        expect(isColorSchemeSignalElement(scope, textArea)).toBe(true);
        expect(isColorSchemeSignalElement(innerHost, textArea)).toBe(true);
        expect(isColorSchemeSignalElement(outerHost, textArea)).toBe(true);
        expect(isColorSchemeSignalElement(document.body, textArea)).toBe(true);
        expect(isColorSchemeSignalElement(document.createElement("div"), textArea)).toBe(false);
    });

    test("walks from an assigned textarea through its open ShadowRoot slot scope and host", () => {
        const host = document.createElement("article");
        host.dataset.theme = "dark";
        const root = host.attachShadow({ mode: "open" });
        const scope = document.createElement("section");
        scope.dataset.colorMode = "light";
        const slot = document.createElement("slot");
        slot.name = "editor";
        scope.append(slot);
        root.append(scope);
        const textArea = document.createElement("textarea");
        textArea.slot = "editor";
        textArea.dataset.bsTheme = "dark";
        host.append(textArea);
        document.body.append(host);

        expect(textArea.assignedSlot).toBe(slot);
        expect(collectColorSchemeSignalElements(textArea).slice(0, 4)).toEqual([textArea, slot, scope, host]);
        expect(collectColorSchemeSignals(textArea, createMediaQueryList(false)).themeValuesByElement).toEqual([
            ["dark"],
            ["light"],
            ["dark"]
        ]);
    });

    test("stops at a closed ShadowRoot boundary", () => {
        const host = document.createElement("article");
        host.dataset.theme = "dark";
        const root = host.attachShadow({ mode: "closed" });
        const scope = document.createElement("section");
        scope.dataset.colorMode = "light";
        const textArea = document.createElement("textarea");
        scope.append(textArea);
        root.append(scope);
        document.body.append(host);

        expect(collectColorSchemeSignalElements(textArea)).toEqual([textArea, scope]);
        expect(collectColorSchemeSlotRoots(textArea)).toEqual([]);
        expect(collectColorSchemeSignals(textArea, createMediaQueryList(false)).themeValuesByElement).toEqual([
            ["light"]
        ]);
        expect(isColorSchemeSignalElement(host, textArea)).toBe(false);
    });

    test("treats a throwing media-query matches getter as an unmatched fallback", () => {
        const textArea = document.createElement("textarea");
        document.body.append(textArea);
        const mediaQueryList = {
            get matches() {
                throw new Error("matches failed");
            }
        } as unknown as MediaQueryList;
        vi.spyOn(window, "getComputedStyle").mockReturnValue({ colorScheme: "normal" } as CSSStyleDeclaration);

        expect(() => collectColorSchemeSignals(textArea, mediaQueryList)).not.toThrow();
        expect(collectColorSchemeSignals(textArea, mediaQueryList).isDarkMediaMatched).toBe(false);
        expect(resolveActiveColorScheme(collectColorSchemeSignals(textArea, mediaQueryList))).toBe("light");
    });

    test("reads the standard dark preference query without mutating the owner window", () => {
        const mediaQueryList = createMediaQueryList(true);
        const matchMedia = vi.fn(() => mediaQueryList);
        const originalDescriptor = Object.getOwnPropertyDescriptor(window, "matchMedia");
        Object.defineProperty(window, "matchMedia", { configurable: true, value: matchMedia });
        try {
            expect(readColorSchemeMediaQuery(window)).toBe(mediaQueryList);
            expect(matchMedia).toHaveBeenCalledOnce();
            expect(matchMedia).toHaveBeenCalledWith(COLOR_SCHEME_MEDIA_QUERY);
            expect(readColorSchemeMediaQuery(null)).toBeNull();
        } finally {
            if (originalDescriptor) {
                Object.defineProperty(window, "matchMedia", originalDescriptor);
            } else {
                Reflect.deleteProperty(window, "matchMedia");
            }
        }
    });

    test.each(COLOR_SCHEME_SIGNAL_ATTRIBUTES)("recognizes the supported %s mutation attribute", (attributeName) => {
        expect(isColorSchemeSignalAttribute(attributeName)).toBe(true);
    });

    test.each([null, "id", "title", "aria-label", "data-custom", "data-palette"])(
        "ignores the unrelated %s mutation attribute",
        (attributeName) => {
            expect(isColorSchemeSignalAttribute(attributeName)).toBe(false);
        }
    );
});
