export type ActiveColorScheme = "light" | "dark";

export interface ColorSchemeSignals {
    readonly computedColorScheme: string;
    readonly isDarkMediaMatched: boolean;
    readonly themeValuesByElement: readonly (readonly string[])[];
}

export const COLOR_SCHEME_MEDIA_QUERY = "(prefers-color-scheme: dark)";

const THEME_ATTRIBUTES = ["data-theme", "data-color-mode", "data-bs-theme"] as const;

export const COLOR_SCHEME_SIGNAL_ATTRIBUTES = ["class", "style", ...THEME_ATTRIBUTES] as const;

const normalizeAsciiColorSchemeSignal = (value: string): string =>
    value
        .replace(/[\t\n\f\r ]+/g, " ")
        .replace(/^[\t\n\f\r ]|[\t\n\f\r ]$/g, "")
        .replace(/[A-Z]/g, (character) => character.toLowerCase());

const resolveComputedColorScheme = (value: string): ActiveColorScheme | undefined => {
    const normalizedValue = normalizeAsciiColorSchemeSignal(value);
    if (normalizedValue === "dark" || normalizedValue === "dark only" || normalizedValue === "only dark") {
        return "dark";
    }
    if (normalizedValue === "light" || normalizedValue === "light only" || normalizedValue === "only light") {
        return "light";
    }
    return undefined;
};

const resolveThemeValue = (value: string): ActiveColorScheme | undefined => {
    const normalizedValue = normalizeAsciiColorSchemeSignal(value);
    return normalizedValue === "light" || normalizedValue === "dark" ? normalizedValue : undefined;
};

export const resolveActiveColorScheme = ({
    computedColorScheme,
    isDarkMediaMatched,
    themeValuesByElement
}: ColorSchemeSignals): ActiveColorScheme => {
    const computedScheme = resolveComputedColorScheme(computedColorScheme);
    if (computedScheme) {
        return computedScheme;
    }
    for (const themeValues of themeValuesByElement) {
        const recognizedSchemes = new Set<ActiveColorScheme>();
        for (const themeValue of themeValues) {
            const themeScheme = resolveThemeValue(themeValue);
            if (themeScheme) {
                recognizedSchemes.add(themeScheme);
            }
        }
        if (recognizedSchemes.size === 1) {
            return recognizedSchemes.values().next().value as ActiveColorScheme;
        }
    }
    return isDarkMediaMatched ? "dark" : "light";
};

const isNode = (value: unknown): value is Node =>
    typeof value === "object" &&
    value !== null &&
    "nodeType" in value &&
    typeof (value as { readonly nodeType?: unknown }).nodeType === "number";

const isElement = (value: unknown): value is Element =>
    isNode(value) && value.nodeType === 1 && typeof (value as Element).getAttribute === "function";

const isOpenShadowRoot = (value: unknown): value is ShadowRoot =>
    isNode(value) &&
    value.nodeType === 11 &&
    "host" in value &&
    isElement((value as { readonly host?: unknown }).host) &&
    (value as ShadowRoot).mode === "open";

const getAssignedSlotInOpenShadowRoot = (node: Node): HTMLSlotElement | null => {
    if (!isElement(node) || !("assignedSlot" in node)) {
        return null;
    }
    const assignedSlot = (node as Element & { readonly assignedSlot?: HTMLSlotElement | null }).assignedSlot;
    return assignedSlot && isOpenShadowRoot(assignedSlot.getRootNode()) ? assignedSlot : null;
};

const getComposedParentElement = (node: Node): Element | null => {
    const assignedSlot = getAssignedSlotInOpenShadowRoot(node);
    if (assignedSlot) {
        return assignedSlot;
    }
    if (isElement(node) && "assignedSlot" in node && node.assignedSlot) {
        return null;
    }
    if (node.parentElement) {
        return node.parentElement;
    }
    return isOpenShadowRoot(node.parentNode) ? node.parentNode.host : null;
};

export const collectColorSchemeSignalElements = (textArea: HTMLTextAreaElement): readonly Element[] => {
    const elements: Element[] = [];
    let element: Element | null = textArea;
    while (element) {
        elements.push(element);
        element = getComposedParentElement(element);
    }
    return elements;
};

export const collectColorSchemeSlotRoots = (textArea: HTMLTextAreaElement): readonly ShadowRoot[] => {
    const roots = new Set<ShadowRoot>();
    for (const element of collectColorSchemeSignalElements(textArea)) {
        const parentShadowRoot = element.parentElement?.shadowRoot;
        if (parentShadowRoot && isOpenShadowRoot(parentShadowRoot)) {
            roots.add(parentShadowRoot);
        }
        if (element.localName === "slot") {
            const root = element.getRootNode();
            if (isOpenShadowRoot(root)) {
                roots.add(root);
            }
        }
    }
    return [...roots];
};

const collectThemeValuesByElement = (textArea: HTMLTextAreaElement): readonly (readonly string[])[] => {
    const valuesByElement: string[][] = [];
    for (const element of collectColorSchemeSignalElements(textArea)) {
        const values = THEME_ATTRIBUTES.flatMap((attributeName) => {
            const value = element.getAttribute(attributeName);
            return value === null ? [] : [value];
        });
        if (values.length > 0) {
            valuesByElement.push(values);
        }
    }
    return valuesByElement;
};

const readComputedColorScheme = (textArea: HTMLTextAreaElement): string => {
    try {
        return textArea.ownerDocument.defaultView?.getComputedStyle(textArea).colorScheme ?? "";
    } catch {
        return "";
    }
};

export const readColorSchemeMediaQuery = (ownerWindow: Window | null): MediaQueryList | null => {
    try {
        return ownerWindow && typeof ownerWindow.matchMedia === "function"
            ? ownerWindow.matchMedia(COLOR_SCHEME_MEDIA_QUERY)
            : null;
    } catch {
        return null;
    }
};

const readIsDarkMediaMatched = (mediaQueryList: MediaQueryList | null): boolean => {
    try {
        return mediaQueryList?.matches === true;
    } catch {
        return false;
    }
};

export const collectColorSchemeSignals = (
    textArea: HTMLTextAreaElement,
    mediaQueryList: MediaQueryList | null = readColorSchemeMediaQuery(textArea.ownerDocument.defaultView)
): ColorSchemeSignals => ({
    computedColorScheme: readComputedColorScheme(textArea),
    isDarkMediaMatched: readIsDarkMediaMatched(mediaQueryList),
    themeValuesByElement: collectThemeValuesByElement(textArea)
});

export const isColorSchemeSignalAttribute = (attributeName: string | null): boolean =>
    COLOR_SCHEME_SIGNAL_ATTRIBUTES.some((supportedAttributeName) => supportedAttributeName === attributeName);

export const isColorSchemeSignalElement = (element: Element, textArea: HTMLTextAreaElement): boolean => {
    let scopeElement: Element | null = textArea;
    while (scopeElement) {
        if (scopeElement === element) {
            return true;
        }
        scopeElement = getComposedParentElement(scopeElement);
    }
    return false;
};
