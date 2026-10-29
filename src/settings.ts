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

export type SettingsUpdateOutcome = "applied" | "read-only" | "conflict";
export interface SettingsUpdateResult {
    readonly settings: MarkdownEnhancerSettings;
    readonly outcome: SettingsUpdateOutcome;
}

export interface SettingsStore extends SettingsSource {
    readonly canUpdateSettings: () => boolean;
    readonly subscribeSettings: (listener: (settings: MarkdownEnhancerSettings) => void) => () => void;
    readonly updateSettings: (update: SettingsUpdate) => MarkdownEnhancerSettings;
    readonly updateSettingsWithOutcome?: (update: SettingsUpdate) => SettingsUpdateResult;
}

type UnknownRecord = Record<string, unknown>;

const SHORTCUT_COMMAND_IDS: readonly ShortcutCommandId[] = ["bold", "italic", "link"];
const BULLET_STYLES: readonly BulletStyle[] = ["-", "*", "+"];

export const createDefaultSettings = (): MarkdownEnhancerSettings =>
    Object.freeze({
        version: 1,
        isEnabled: true,
        isToolbarEnabled: true,
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
        const shortcutIdsByKey = new Map<string, ShortcutCommandId[]>();
        for (const commandId of SHORTCUT_COMMAND_IDS) {
            const shortcut = overrides[commandId] ?? DEFAULT_SHORTCUTS[commandId];
            const shortcutKey = getShortcutGroupKey(shortcut);
            const shortcutIds = shortcutIdsByKey.get(shortcutKey) ?? [];
            shortcutIds.push(commandId);
            shortcutIdsByKey.set(shortcutKey, shortcutIds);
        }

        const conflictingOverrideIds = new Set<ShortcutCommandId>();
        for (const shortcutIds of shortcutIdsByKey.values()) {
            if (shortcutIds.length > 1) {
                for (const commandId of shortcutIds) {
                    if (overrides[commandId] !== undefined) {
                        conflictingOverrideIds.add(commandId);
                    }
                }
            }
        }
        if (conflictingOverrideIds.size === 0) {
            break;
        }
        for (const commandId of SHORTCUT_COMMAND_IDS) {
            if (conflictingOverrideIds.has(commandId)) {
                delete overrides[commandId];
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

const MAX_SETTINGS_UPDATE_ATTEMPTS = 3;

export const createSettingsStore = (storage: SettingsStorage): SettingsStore => {
    let rawSettings: unknown = createDefaultSettings();
    try {
        rawSettings = storage.readValue(SETTINGS_STORAGE_KEY);
    } catch {
        // Keep default in-memory settings available while storage is unavailable.
    }
    const listeners = new Set<(settings: MarkdownEnhancerSettings) => void>();
    let latestRawValue = rawSettings;
    let currentSettings = normalizeSettings(rawSettings);
    let isNotifyingSettings = false;
    let hasPendingSettingsNotification = false;
    if (!hasUnsupportedStoredSchemaVersion(rawSettings) && !areValuesEqual(rawSettings, currentSettings)) {
        try {
            storage.writeValue(SETTINGS_STORAGE_KEY, currentSettings);
        } catch {
            // A later user action reports unavailable storage through canUpdateSettings or updateSettings.
        }
    }

    const notifySettings = (): void => {
        if (isNotifyingSettings) {
            hasPendingSettingsNotification = true;
            return;
        }
        isNotifyingSettings = true;
        try {
            do {
                hasPendingSettingsNotification = false;
                const notifiedSettings = currentSettings;
                for (const listener of [...listeners]) {
                    if (listeners.has(listener)) {
                        try {
                            listener(notifiedSettings);
                        } catch {
                            // One optional subscriber must not block later settings consumers or change save outcomes.
                        }
                    }
                }
            } while (hasPendingSettingsNotification);
        } finally {
            isNotifyingSettings = false;
            hasPendingSettingsNotification = false;
        }
    };

    const refreshLatestSettings = (): MarkdownEnhancerSettings => {
        latestRawValue = storage.readValue(SETTINGS_STORAGE_KEY);
        const latestSettings = normalizeSettings(latestRawValue);
        if (!areValuesEqual(currentSettings, latestSettings)) {
            currentSettings = latestSettings;
            notifySettings();
        }
        return currentSettings;
    };

    const getLatestSettings = (): MarkdownEnhancerSettings => {
        try {
            return refreshLatestSettings();
        } catch {
            return currentSettings;
        }
    };

    const updateSettingsWithOutcome = (update: SettingsUpdate): SettingsUpdateResult => {
        let candidateSettings = refreshLatestSettings();
        if (hasUnsupportedStoredSchemaVersion(latestRawValue)) {
            return { settings: candidateSettings, outcome: "read-only" };
        }

        for (let attempt = 0; attempt < MAX_SETTINGS_UPDATE_ATTEMPTS; attempt += 1) {
            const changes = typeof update === "function" ? update(candidateSettings) : update;
            const verifiedSettings = refreshLatestSettings();
            if (hasUnsupportedStoredSchemaVersion(latestRawValue)) {
                return { settings: verifiedSettings, outcome: "read-only" };
            }
            if (!areValuesEqual(candidateSettings, verifiedSettings)) {
                candidateSettings = verifiedSettings;
                continue;
            }

            const nextSettings = normalizeCurrentSettings({ ...verifiedSettings, ...changes, version: 1 });
            if (!areValuesEqual(latestRawValue, nextSettings)) {
                storage.writeValue(SETTINGS_STORAGE_KEY, nextSettings);
                currentSettings = nextSettings;
                notifySettings();
            }
            return { settings: currentSettings, outcome: "applied" };
        }

        return { settings: currentSettings, outcome: "conflict" };
    };

    return {
        canUpdateSettings: () => {
            refreshLatestSettings();
            return !hasUnsupportedStoredSchemaVersion(latestRawValue);
        },
        getSettings: getLatestSettings,
        subscribeSettings: (listener) => {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
        updateSettings: (update) => updateSettingsWithOutcome(update).settings,
        updateSettingsWithOutcome
    };
};
