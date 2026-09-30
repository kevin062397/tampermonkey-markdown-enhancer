import type { CommandShortcut } from "./command-registry";
import type { BulletStyle } from "./line-prefixes";

export const SETTINGS_STORAGE_KEY = "tampermonkey-markdown-enhancer.settings";
export const MAX_EDITOR_SELECTOR_COUNT = 32;
export const MAX_EDITOR_SELECTOR_LENGTH = 256;

export type ShortcutCommandId = "bold" | "italic" | "link";
export interface ShortcutOverride extends CommandShortcut {
    readonly isPrimaryModifierRequired: true;
}
export type ShortcutOverrides = Partial<Record<ShortcutCommandId, ShortcutOverride>>;

export const DEFAULT_SHORTCUTS: Readonly<Record<ShortcutCommandId, ShortcutOverride>> = Object.freeze({
    bold: Object.freeze({ key: "b", isPrimaryModifierRequired: true }),
    italic: Object.freeze({ key: "i", isPrimaryModifierRequired: true }),
    link: Object.freeze({ key: "k", isPrimaryModifierRequired: true })
});

export interface MarkdownEnhancerSettings {
    readonly version: 1;
    readonly isEnabled: boolean;
    readonly isToolbarEnabled: boolean;
    readonly isCommandPaletteEnabled: boolean;
    readonly isPreviewEnabled: boolean;
    readonly tabWidth: number;
    readonly bulletStyle: BulletStyle;
    readonly shortcutOverrides: ShortcutOverrides;
    readonly excludedHostnames: readonly string[];
    readonly excludedEditorSelectors: readonly string[];
}

export interface SettingsStorage {
    readonly readValue: (key: string) => unknown;
    readonly writeValue: (key: string, value: MarkdownEnhancerSettings) => void;
}

export interface SettingsSource {
    readonly getSettings: () => MarkdownEnhancerSettings;
    readonly subscribeSettings?: (listener: (settings: MarkdownEnhancerSettings) => void) => () => void;
}

export type SettingsUpdate =
    Partial<MarkdownEnhancerSettings> | ((settings: MarkdownEnhancerSettings) => Partial<MarkdownEnhancerSettings>);

export interface SettingsStore extends SettingsSource {
    readonly subscribeSettings: (listener: (settings: MarkdownEnhancerSettings) => void) => () => void;
    readonly updateSettings: (update: SettingsUpdate) => MarkdownEnhancerSettings;
}

type UnknownRecord = Record<string, unknown>;

const SHORTCUT_COMMAND_IDS: readonly ShortcutCommandId[] = ["bold", "italic", "link"];
const BULLET_STYLES: readonly BulletStyle[] = ["-", "*", "+"];

export const createDefaultSettings = (): MarkdownEnhancerSettings =>
    Object.freeze({
        version: 1,
        isEnabled: true,
        isToolbarEnabled: true,
        isCommandPaletteEnabled: true,
        isPreviewEnabled: true,
        tabWidth: 4,
        bulletStyle: "-",
        shortcutOverrides: Object.freeze({}),
        excludedHostnames: Object.freeze([]),
        excludedEditorSelectors: Object.freeze([])
    });

const isRecord = (value: unknown): value is UnknownRecord =>
    typeof value === "object" && value !== null && !Array.isArray(value);

const normalizeBoolean = (value: unknown, isFallback: boolean): boolean =>
    typeof value === "boolean" ? value : isFallback;

const normalizeTabWidth = (value: unknown): number =>
    typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 16 ? value : 4;

const normalizeBulletStyle = (value: unknown): BulletStyle =>
    typeof value === "string" && BULLET_STYLES.indexOf(value as BulletStyle) >= 0 ? (value as BulletStyle) : "-";

const areShortcutsEqual = (left: CommandShortcut, right: CommandShortcut): boolean =>
    left.key === right.key && left.isPrimaryModifierRequired === right.isPrimaryModifierRequired;

export const normalizeCommandShortcut = (value: unknown): ShortcutOverride | undefined => {
    if (!isRecord(value)) {
        return undefined;
    }
    const key = typeof value.key === "string" ? value.key.trim().toLowerCase() : "";
    if (!/^[a-z0-9]$/.test(key) || value.isPrimaryModifierRequired !== true) {
        return undefined;
    }
    return Object.freeze({ key, isPrimaryModifierRequired: value.isPrimaryModifierRequired });
};

const getShortcutGroupKey = (shortcut: CommandShortcut): string =>
    `${shortcut.isPrimaryModifierRequired ? "modified" : "plain"}:${shortcut.key}`;

const normalizeShortcutOverrides = (value: unknown): ShortcutOverrides => {
    if (!isRecord(value)) {
        return Object.freeze({});
    }

    const overrides: ShortcutOverrides = {};
    for (const commandId of SHORTCUT_COMMAND_IDS) {
        const shortcut = normalizeCommandShortcut(value[commandId]);
        if (shortcut) {
            overrides[commandId] = shortcut;
        }
    }

    while (true) {
        const effectiveShortcuts = new Map<string, ShortcutCommandId[]>();
        for (const commandId of SHORTCUT_COMMAND_IDS) {
            const shortcut = overrides[commandId] ?? DEFAULT_SHORTCUTS[commandId];
            const groupKey = getShortcutGroupKey(shortcut);
            effectiveShortcuts.set(groupKey, [...(effectiveShortcuts.get(groupKey) ?? []), commandId]);
        }

        const duplicateGroups = [...effectiveShortcuts.values()].filter((commandIds) => commandIds.length > 1);
        if (duplicateGroups.length === 0) {
            break;
        }

        for (const commandIds of duplicateGroups) {
            const defaultOwner = commandIds.find((commandId) =>
                areShortcutsEqual(overrides[commandId] ?? DEFAULT_SHORTCUTS[commandId], DEFAULT_SHORTCUTS[commandId])
            );
            const retainedCommandId = defaultOwner ?? commandIds[0];
            for (const commandId of commandIds) {
                if (commandId !== retainedCommandId) {
                    delete overrides[commandId];
                }
            }
        }
    }

    return Object.freeze(overrides);
};

export const doesShortcutOverrideCollide = (
    existingOverrides: ShortcutOverrides,
    commandId: ShortcutCommandId,
    proposedShortcut: ShortcutOverride
): boolean => {
    const normalizedOverrides = normalizeShortcutOverrides(existingOverrides);
    return SHORTCUT_COMMAND_IDS.some((otherCommandId) => {
        if (otherCommandId === commandId) {
            return false;
        }
        const effectiveShortcut = normalizedOverrides[otherCommandId] ?? DEFAULT_SHORTCUTS[otherCommandId];
        return areShortcutsEqual(effectiveShortcut, proposedShortcut);
    });
};

export const canonicalizeHostname = (value: unknown): string | undefined => {
    if (typeof value !== "string") {
        return undefined;
    }
    const candidate = value.trim();
    if (!candidate || /[\s\\/?#@]/u.test(candidate)) {
        return undefined;
    }

    const isBracketed = candidate.startsWith("[") && candidate.endsWith("]");
    if (candidate.includes("[") !== isBracketed || candidate.includes("]") !== isBracketed) {
        return undefined;
    }
    const hostForUrl = !isBracketed && candidate.includes(":") ? `[${candidate}]` : candidate;

    let hostname: string;
    try {
        hostname = new URL(`https://${hostForUrl}/`).hostname.toLowerCase();
    } catch {
        return undefined;
    }
    if (hostname.endsWith(".")) {
        hostname = hostname.slice(0, -1);
    }
    if (!hostname || hostname.endsWith(".")) {
        return undefined;
    }
    if (hostname.startsWith("[") && hostname.endsWith("]")) {
        return hostname;
    }
    if (hostname.length > 253) {
        return undefined;
    }
    const labels = hostname.split(".");
    if (
        labels.some(
            (label) =>
                label.length === 0 ||
                label.length > 63 ||
                !/^[a-z0-9-]+$/.test(label) ||
                label.startsWith("-") ||
                label.endsWith("-")
        )
    ) {
        return undefined;
    }
    return hostname;
};

const normalizeHostnames = (value: unknown): readonly string[] => {
    if (!Array.isArray(value)) {
        return Object.freeze([]);
    }
    const hostnames = value.map(canonicalizeHostname).filter((hostname): hostname is string => hostname !== undefined);
    return Object.freeze([...new Set(hostnames)]);
};

const isEditorSelectorValid = (editor: HTMLTextAreaElement, selector: string): boolean => {
    try {
        editor.matches(selector);
        return true;
    } catch {
        return false;
    }
};

export const normalizeEditorSelectors = (value: unknown): readonly string[] => {
    if (!Array.isArray(value)) {
        return Object.freeze([]);
    }
    const editor = document.createElement("textarea");
    const selectorEntries = value
        .filter((entry): entry is string => typeof entry === "string")
        .reduce<string[]>((entries, entry) => {
            entries.push(...entry.split(/\r?\n/));
            return entries;
        }, []);
    const selectors = selectorEntries
        .map((entry) => entry.trim())
        .filter(
            (entry) =>
                entry.length > 0 && entry.length <= MAX_EDITOR_SELECTOR_LENGTH && isEditorSelectorValid(editor, entry)
        );
    return Object.freeze([...new Set(selectors)].slice(0, MAX_EDITOR_SELECTOR_COUNT));
};

const normalizeCurrentSettings = (value: UnknownRecord): MarkdownEnhancerSettings =>
    Object.freeze({
        version: 1,
        isEnabled: normalizeBoolean(value.isEnabled, true),
        isToolbarEnabled: normalizeBoolean(value.isToolbarEnabled, true),
        isCommandPaletteEnabled: normalizeBoolean(value.isCommandPaletteEnabled, true),
        isPreviewEnabled: normalizeBoolean(value.isPreviewEnabled, true),
        tabWidth: normalizeTabWidth(value.tabWidth),
        bulletStyle: normalizeBulletStyle(value.bulletStyle),
        shortcutOverrides: normalizeShortcutOverrides(value.shortcutOverrides),
        excludedHostnames: normalizeHostnames(value.excludedHostnames),
        excludedEditorSelectors: normalizeEditorSelectors(value.excludedEditorSelectors)
    });

const migrateLegacySettings = (value: UnknownRecord): MarkdownEnhancerSettings =>
    normalizeCurrentSettings({
        isEnabled: value.enabled,
        isToolbarEnabled: value.toolbarEnabled,
        isCommandPaletteEnabled: value.commandPaletteEnabled,
        isPreviewEnabled: value.previewEnabled,
        tabWidth: value.tabSize,
        bulletStyle: value.bulletCharacter,
        shortcutOverrides: value.shortcutOverrides,
        excludedHostnames: value.excludedHostnames,
        excludedEditorSelectors: value.excludedEditorSelectors
    });

export const normalizeSettings = (value: unknown): MarkdownEnhancerSettings => {
    if (!isRecord(value)) {
        return createDefaultSettings();
    }
    if (!("version" in value)) {
        return migrateLegacySettings(value);
    }
    return value.version === 1 ? normalizeCurrentSettings(value) : createDefaultSettings();
};

const areValuesEqual = (left: unknown, right: unknown): boolean => {
    if (Object.is(left, right)) {
        return true;
    }
    if (Array.isArray(left) && Array.isArray(right)) {
        return left.length === right.length && left.every((value, index) => areValuesEqual(value, right[index]));
    }
    if (!isRecord(left) || !isRecord(right)) {
        return false;
    }
    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);
    return (
        leftKeys.length === rightKeys.length &&
        leftKeys.every(
            (key) => Object.prototype.hasOwnProperty.call(right, key) && areValuesEqual(left[key], right[key])
        )
    );
};

const hasUnsupportedStoredSchemaVersion = (value: unknown): boolean =>
    isRecord(value) &&
    typeof value.version === "number" &&
    Number.isInteger(value.version) &&
    value.version > createDefaultSettings().version;

export const createSettingsStore = (storage: SettingsStorage): SettingsStore => {
    const rawSettings = storage.readValue(SETTINGS_STORAGE_KEY);
    const listeners = new Set<(settings: MarkdownEnhancerSettings) => void>();
    let latestRawValue = rawSettings;
    let currentSettings = normalizeSettings(rawSettings);
    if (!hasUnsupportedStoredSchemaVersion(rawSettings) && !areValuesEqual(rawSettings, currentSettings)) {
        storage.writeValue(SETTINGS_STORAGE_KEY, currentSettings);
    }

    const notifySettings = (): void => {
        for (const listener of listeners) {
            listener(currentSettings);
        }
    };

    const getLatestSettings = (): MarkdownEnhancerSettings => {
        latestRawValue = storage.readValue(SETTINGS_STORAGE_KEY);
        const latestSettings = normalizeSettings(latestRawValue);
        if (!areValuesEqual(currentSettings, latestSettings)) {
            currentSettings = latestSettings;
            notifySettings();
        }
        return currentSettings;
    };

    return {
        getSettings: getLatestSettings,
        subscribeSettings: (listener) => {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
        updateSettings: (update) => {
            const latestSettings = getLatestSettings();
            if (hasUnsupportedStoredSchemaVersion(latestRawValue)) {
                return latestSettings;
            }

            const changes = typeof update === "function" ? update(latestSettings) : update;
            const nextSettings = normalizeCurrentSettings({ ...latestSettings, ...changes, version: 1 });
            if (areValuesEqual(latestRawValue, nextSettings)) {
                return currentSettings;
            }

            currentSettings = nextSettings;
            storage.writeValue(SETTINGS_STORAGE_KEY, currentSettings);
            notifySettings();
            return currentSettings;
        }
    };
};
