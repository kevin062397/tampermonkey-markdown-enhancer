import type { CommandShortcut } from "./command-registry";
import type { PrimaryModifierLabel } from "./platform";
import {
    canonicalizeHostname,
    DEFAULT_SHORTCUTS,
    doesShortcutOverrideCollide,
    MAX_EDITOR_SELECTOR_COUNT,
    MAX_EDITOR_SELECTOR_LENGTH,
    normalizeCommandShortcut,
    normalizeEditorSelectors,
    type SettingsStore,
    type ShortcutCommandId,
    type ShortcutOverride,
    type ShortcutOverrides
} from "./settings";

export interface SettingsMenuEnvironment {
    readonly registerCommand: (label: string, callback: () => void) => void;
    readonly requestInput: (prompt: string, currentValue: string) => string | null;
    readonly getPrimaryModifierLabel: () => PrimaryModifierLabel;
    readonly getPageUrl: () => URL;
}

const parseTabWidth = (input: string): number | undefined => {
    const tabWidth = Number(input.trim());
    return Number.isInteger(tabWidth) && tabWidth >= 1 && tabWidth <= 16 ? tabWidth : undefined;
};

const parseShortcut = (
    input: string,
    primaryModifierLabel: PrimaryModifierLabel
): ShortcutOverride | null | undefined => {
    const normalizedInput = input.trim().toLowerCase();
    if (!normalizedInput) {
        return null;
    }
    const match = normalizedInput.match(/^([a-z]+)\s*\+\s*([a-z0-9])$/);
    if (!match) {
        return undefined;
    }
    const modifier = match[1];
    const acceptedModifiers =
        primaryModifierLabel === "Command" ? ["command", "cmd", "mod"] : ["control", "ctrl", "mod"];
    if (modifier && acceptedModifiers.indexOf(modifier) < 0) {
        return undefined;
    }
    return normalizeCommandShortcut({ key: match[2], isPrimaryModifierRequired: true });
};

const formatShortcut = (shortcut: CommandShortcut, primaryModifierLabel: PrimaryModifierLabel): string =>
    shortcut.isPrimaryModifierRequired
        ? `${primaryModifierLabel}+${shortcut.key.toUpperCase()}`
        : shortcut.key.toUpperCase();

const updateShortcutOverride = (
    store: SettingsStore,
    commandId: ShortcutCommandId,
    shortcut: ShortcutOverride | null
): void => {
    store.updateSettings((settings) => {
        const effectiveShortcut = shortcut ?? DEFAULT_SHORTCUTS[commandId];
        if (doesShortcutOverrideCollide(settings.shortcutOverrides, commandId, effectiveShortcut)) {
            return {};
        }
        const shortcutOverrides: ShortcutOverrides = { ...settings.shortcutOverrides };
        if (shortcut) {
            shortcutOverrides[commandId] = shortcut;
        } else {
            delete shortcutOverrides[commandId];
        }
        return { shortcutOverrides };
    });
};

const registerShortcutAction = (
    environment: SettingsMenuEnvironment,
    store: SettingsStore,
    commandId: ShortcutCommandId,
    label: string
): void => {
    environment.registerCommand(label, () => {
        const shortcutOverrides = store.getSettings().shortcutOverrides;
        const primaryModifierLabel = environment.getPrimaryModifierLabel();
        const defaultShortcut = formatShortcut(DEFAULT_SHORTCUTS[commandId], primaryModifierLabel);
        const currentShortcut = shortcutOverrides[commandId] ?? DEFAULT_SHORTCUTS[commandId];
        const input = environment.requestInput(
            `${label} (Use ${defaultShortcut}; Default: ${defaultShortcut}; Leave Blank to Restore Default When Available)`,
            formatShortcut(currentShortcut, primaryModifierLabel)
        );
        if (input === null) {
            return;
        }
        const shortcut = parseShortcut(input, primaryModifierLabel);
        if (shortcut !== undefined) {
            updateShortcutOverride(store, commandId, shortcut);
        }
    });
};

const registerEditingToggle = (environment: SettingsMenuEnvironment, store: SettingsStore): void => {
    environment.registerCommand("Toggle Markdown Editing", () => {
        store.updateSettings((settings) => ({ isEnabled: !settings.isEnabled }));
    });
};

const registerToolbarToggle = (environment: SettingsMenuEnvironment, store: SettingsStore): void => {
    environment.registerCommand("Toggle Formatting Toolbar", () => {
        store.updateSettings((settings) => ({ isToolbarEnabled: !settings.isToolbarEnabled }));
    });
};

const registerTabWidthAction = (environment: SettingsMenuEnvironment, store: SettingsStore): void => {
    environment.registerCommand("Set Tab Width", () => {
        const settings = store.getSettings();
        const input = environment.requestInput("Tab Width (1–16)", String(settings.tabWidth));
        if (input === null) {
            return;
        }
        const tabWidth = parseTabWidth(input);
        if (tabWidth !== undefined) {
            store.updateSettings({ tabWidth });
        }
    });
};

const registerHostnameAction = (environment: SettingsMenuEnvironment, store: SettingsStore): void => {
    environment.registerCommand("Toggle Current Hostname Exclusion", () => {
        const hostname = canonicalizeHostname(environment.getPageUrl().hostname);
        if (!hostname) {
            return;
        }
        store.updateSettings((settings) => {
            const excludedHostnames = [...settings.excludedHostnames];
            const hostnameIndex = excludedHostnames.indexOf(hostname);
            if (hostnameIndex >= 0) {
                excludedHostnames.splice(hostnameIndex, 1);
            } else {
                excludedHostnames.push(hostname);
            }
            return { excludedHostnames };
        });
    });
};

const registerEditorSelectorAction = (environment: SettingsMenuEnvironment, store: SettingsStore): void => {
    environment.registerCommand("Toggle Editor Exclusion Selector", () => {
        const input = environment.requestInput("Editor Exclusion Selector (Enter Existing to Remove)", "");
        if (input === null || /[\r\n]/.test(input)) {
            return;
        }

        const selector = input.trim();
        if (!selector || selector.length > MAX_EDITOR_SELECTOR_LENGTH) {
            return;
        }
        const normalizedSelector = normalizeEditorSelectors([selector]);
        if (normalizedSelector.length !== 1) {
            return;
        }

        store.updateSettings((settings) => {
            const excludedEditorSelectors = [...settings.excludedEditorSelectors];
            const selectorIndex = excludedEditorSelectors.indexOf(normalizedSelector[0]);
            if (selectorIndex >= 0) {
                excludedEditorSelectors.splice(selectorIndex, 1);
            } else {
                if (excludedEditorSelectors.length >= MAX_EDITOR_SELECTOR_COUNT) {
                    return {};
                }
                excludedEditorSelectors.push(normalizedSelector[0]);
            }
            return { excludedEditorSelectors };
        });
    });
};

export const registerSettingsMenu = (environment: SettingsMenuEnvironment, store: SettingsStore): void => {
    registerEditingToggle(environment, store);
    registerToolbarToggle(environment, store);
    registerTabWidthAction(environment, store);
    registerShortcutAction(environment, store, "bold", "Set Bold Shortcut");
    registerShortcutAction(environment, store, "italic", "Set Italic Shortcut");
    registerShortcutAction(environment, store, "link", "Set Link Shortcut");
    registerHostnameAction(environment, store);
    registerEditorSelectorAction(environment, store);
};
