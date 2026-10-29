import type { CommandShortcut } from "./command-registry";
import type { PrimaryModifierLabel } from "./platform";
import {
    canonicalizeHostname,
    createDefaultSettings,
    DEFAULT_SHORTCUTS,
    doesShortcutOverrideCollide,
    MAX_EDITOR_SELECTOR_COUNT,
    MAX_EDITOR_SELECTOR_LENGTH,
    normalizeCommandShortcut,
    normalizeEditorSelectors,
    type MarkdownEnhancerSettings,
    type SettingsStore,
    type SettingsUpdate,
    type ShortcutCommandId,
    type ShortcutOverride,
    type ShortcutOverrides
} from "./settings";

export interface SettingsMenuEnvironment {
    readonly registerCommand: (label: string, callback: () => void, existingCommandId?: number) => unknown;
    readonly requestInput: (prompt: string, currentValue: string) => string | null;
    readonly reportStatus: (message: string) => void;
    readonly getPrimaryModifierLabel: () => PrimaryModifierLabel;
    readonly getPageUrl: () => URL;
}

export interface SettingsMenuController {
    readonly refresh: () => void;
}

const reportStatus = (environment: SettingsMenuEnvironment, message: string): void => {
    try {
        environment.reportStatus(message);
    } catch {
        // Status presentation must not escape into the page or settings runtime.
    }
};

const registerMenuCommand = (
    environment: SettingsMenuEnvironment,
    label: string,
    callback: () => void,
    existingCommandId?: number
): number | undefined => {
    try {
        const commandId = environment.registerCommand(
            label,
            () => {
                try {
                    callback();
                } catch {
                    reportStatus(
                        environment,
                        "The settings action could not be completed. Try again after reloading the page."
                    );
                }
            },
            existingCommandId
        );
        const isValidCommandId = typeof commandId === "number" && Number.isFinite(commandId);
        return isValidCommandId ? commandId : existingCommandId;
    } catch {
        return existingCommandId;
    }
};

const readSettings = (
    environment: SettingsMenuEnvironment,
    store: SettingsStore
): MarkdownEnhancerSettings | undefined => {
    try {
        return store.getSettings();
    } catch {
        reportStatus(environment, "Settings are unavailable. Try again after reloading the page.");
        return undefined;
    }
};

const canUpdateSettings = (environment: SettingsMenuEnvironment, store: SettingsStore): boolean => {
    try {
        if (store.canUpdateSettings()) {
            return true;
        }
        reportStatus(
            environment,
            "Settings are read-only because they were created by a newer Markdown Enhancer version."
        );
    } catch {
        reportStatus(environment, "Settings are unavailable. Try again after reloading the page.");
    }
    return false;
};

const applySettingsUpdate = (
    environment: SettingsMenuEnvironment,
    store: SettingsStore,
    update: SettingsUpdate
): MarkdownEnhancerSettings | undefined => {
    if (!canUpdateSettings(environment, store)) {
        return undefined;
    }
    try {
        let hasUpdateBeenEvaluated = false;
        const evaluateUpdate = (settings: MarkdownEnhancerSettings) => {
            hasUpdateBeenEvaluated = true;
            return typeof update === "function" ? update(settings) : update;
        };
        const result = store.updateSettingsWithOutcome
            ? store.updateSettingsWithOutcome(evaluateUpdate)
            : {
                  settings: store.updateSettings(evaluateUpdate),
                  outcome: hasUpdateBeenEvaluated ? ("applied" as const) : ("read-only" as const)
              };
        if (result.outcome === "read-only") {
            reportStatus(
                environment,
                "Settings are read-only because they were created by a newer Markdown Enhancer version."
            );
            return undefined;
        }
        if (result.outcome === "conflict") {
            reportStatus(environment, "Settings changed repeatedly in another tab. Try the action again.");
            return undefined;
        }
        return result.settings;
    } catch {
        reportStatus(environment, "Settings could not be saved. Try again after reloading the page.");
        return undefined;
    }
};

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

const getShortcutLabel = (commandId: ShortcutCommandId): string =>
    commandId === "bold" ? "Bold" : commandId === "italic" ? "Italic" : "Link";

const getConflictingShortcutLabel = (
    shortcutOverrides: ShortcutOverrides,
    commandId: ShortcutCommandId,
    shortcut: ShortcutOverride
): string | undefined => {
    const shortcutCommandIds: readonly ShortcutCommandId[] = ["bold", "italic", "link"];
    const conflictingCommandId = shortcutCommandIds.find((otherCommandId) => {
        if (otherCommandId === commandId) {
            return false;
        }
        const effectiveShortcut = shortcutOverrides[otherCommandId] ?? DEFAULT_SHORTCUTS[otherCommandId];
        return (
            effectiveShortcut.key === shortcut.key &&
            effectiveShortcut.isPrimaryModifierRequired === shortcut.isPrimaryModifierRequired
        );
    });
    return conflictingCommandId ? getShortcutLabel(conflictingCommandId) : undefined;
};

const getEditingActionLabel = (settings: MarkdownEnhancerSettings): string =>
    settings.isEnabled ? "Disable Markdown Editing" : "Enable Markdown Editing";

const getToolbarActionLabel = (settings: MarkdownEnhancerSettings): string =>
    settings.isToolbarEnabled ? "Disable Formatting Toolbar" : "Enable Formatting Toolbar";

const getCurrentHostname = (environment: SettingsMenuEnvironment): string | undefined => {
    try {
        return canonicalizeHostname(environment.getPageUrl().hostname);
    } catch {
        return undefined;
    }
};

const getHostnameActionLabel = (settings: MarkdownEnhancerSettings, hostname: string): string =>
    settings.excludedHostnames.includes(hostname) ? "Include This Hostname" : "Exclude This Hostname";

const registerTabWidthAction = (environment: SettingsMenuEnvironment, store: SettingsStore): void => {
    registerMenuCommand(environment, "Set Tab Width", () => {
        if (!canUpdateSettings(environment, store)) {
            return;
        }
        const settings = readSettings(environment, store);
        if (!settings) {
            return;
        }
        const input = environment.requestInput("Tab Width (Whole Number from 1 Through 16)", String(settings.tabWidth));
        if (input === null) {
            return;
        }
        const tabWidth = parseTabWidth(input);
        if (tabWidth === undefined) {
            reportStatus(environment, "Enter a whole-number tab width from 1 through 16.");
            return;
        }
        const updated = applySettingsUpdate(environment, store, { tabWidth });
        if (updated) {
            reportStatus(environment, `Tab width set to ${updated.tabWidth}.`);
        }
    });
};

const registerBulletStyleAction = (environment: SettingsMenuEnvironment, store: SettingsStore): void => {
    registerMenuCommand(environment, "Set Bullet Style", () => {
        if (!canUpdateSettings(environment, store)) {
            return;
        }
        const settings = readSettings(environment, store);
        if (!settings) {
            return;
        }
        const input = environment.requestInput(
            "Bullet Style (-, *, or +; Default: -; Leave Blank to Restore Default)",
            settings.bulletStyle
        );
        if (input === null) {
            return;
        }
        const bulletStyle = input.trim() === "" ? "-" : input.trim();
        if (bulletStyle !== "-" && bulletStyle !== "*" && bulletStyle !== "+") {
            reportStatus(environment, "Enter -, *, or + for the bullet style.");
            return;
        }
        const updated = applySettingsUpdate(environment, store, { bulletStyle });
        if (updated) {
            reportStatus(
                environment,
                input.trim() === "" ? "Bullet style restored to -." : `Bullet style set to ${updated.bulletStyle}.`
            );
        }
    });
};

const registerShortcutAction = (
    environment: SettingsMenuEnvironment,
    store: SettingsStore,
    commandId: ShortcutCommandId
): void => {
    const shortcutLabel = getShortcutLabel(commandId);
    registerMenuCommand(environment, `Set ${shortcutLabel} Shortcut`, () => {
        if (!canUpdateSettings(environment, store)) {
            return;
        }
        const settings = readSettings(environment, store);
        if (!settings) {
            return;
        }
        const primaryModifierLabel = environment.getPrimaryModifierLabel();
        const defaultShortcut = formatShortcut(DEFAULT_SHORTCUTS[commandId], primaryModifierLabel);
        const currentShortcut = settings.shortcutOverrides[commandId] ?? DEFAULT_SHORTCUTS[commandId];
        const input = environment.requestInput(
            `${shortcutLabel} Shortcut (Use ${defaultShortcut}; Default: ${defaultShortcut}; Leave Blank to Restore Default When Available)`,
            formatShortcut(currentShortcut, primaryModifierLabel)
        );
        if (input === null) {
            return;
        }
        const shortcut = parseShortcut(input, primaryModifierLabel);
        if (shortcut === undefined) {
            reportStatus(
                environment,
                `Enter the ${shortcutLabel} shortcut as ${primaryModifierLabel} plus one letter or digit, for example ${defaultShortcut}.`
            );
            return;
        }
        const effectiveShortcut = shortcut ?? DEFAULT_SHORTCUTS[commandId];
        let conflictingShortcutLabel: string | undefined;
        const updated = applySettingsUpdate(environment, store, (latestSettings) => {
            conflictingShortcutLabel = undefined;
            if (doesShortcutOverrideCollide(latestSettings.shortcutOverrides, commandId, effectiveShortcut)) {
                conflictingShortcutLabel =
                    getConflictingShortcutLabel(latestSettings.shortcutOverrides, commandId, effectiveShortcut) ??
                    "another formatting shortcut";
                return {};
            }
            const shortcutOverrides: ShortcutOverrides = { ...latestSettings.shortcutOverrides };
            if (shortcut) {
                shortcutOverrides[commandId] = shortcut;
            } else {
                delete shortcutOverrides[commandId];
            }
            return { shortcutOverrides };
        });
        if (!updated) {
            return;
        }
        if (conflictingShortcutLabel) {
            reportStatus(
                environment,
                `${formatShortcut(effectiveShortcut, primaryModifierLabel)} is already assigned to ${conflictingShortcutLabel}.`
            );
            return;
        }
        if (updated) {
            reportStatus(
                environment,
                shortcut
                    ? `${shortcutLabel} shortcut set to ${formatShortcut(shortcut, primaryModifierLabel)}.`
                    : `${shortcutLabel} shortcut restored to ${defaultShortcut}.`
            );
        }
    });
};

const registerEditorSelectorAction = (environment: SettingsMenuEnvironment, store: SettingsStore): void => {
    registerMenuCommand(environment, "Toggle Editor Exclusion Selector", () => {
        if (!canUpdateSettings(environment, store)) {
            return;
        }
        const settings = readSettings(environment, store);
        if (!settings) {
            return;
        }
        const currentSelectors = settings.excludedEditorSelectors.length
            ? settings.excludedEditorSelectors.join("\n")
            : "(none configured)";
        const input = environment.requestInput(
            `Editor Exclusion Selector\nEnter an existing selector to remove it, or another valid selector to add it.\nCurrent Selectors:\n${currentSelectors}`,
            ""
        );
        if (input === null) {
            return;
        }
        if (/\r|\n/.test(input)) {
            reportStatus(environment, "Enter one editor exclusion selector at a time.");
            return;
        }
        const selector = input.trim();
        if (!selector || selector.length > MAX_EDITOR_SELECTOR_LENGTH) {
            reportStatus(
                environment,
                `Enter a nonempty selector containing at most ${MAX_EDITOR_SELECTOR_LENGTH} characters.`
            );
            return;
        }
        const normalizedSelector = normalizeEditorSelectors([selector]);
        if (normalizedSelector.length !== 1) {
            reportStatus(environment, "Enter a valid CSS selector for the editor exclusion.");
            return;
        }

        const canonicalSelector = normalizedSelector[0];
        const isRemovingSelector = settings.excludedEditorSelectors.includes(canonicalSelector);
        let isSelectorCapacityReached = false;
        const updated = applySettingsUpdate(environment, store, (latestSettings) => {
            isSelectorCapacityReached = false;
            const selectorIndex = latestSettings.excludedEditorSelectors.indexOf(canonicalSelector);
            const excludedEditorSelectors = [...latestSettings.excludedEditorSelectors];
            if (isRemovingSelector) {
                if (selectorIndex >= 0) {
                    excludedEditorSelectors.splice(selectorIndex, 1);
                }
                return { excludedEditorSelectors };
            }
            if (selectorIndex >= 0) {
                return {};
            }
            if (latestSettings.excludedEditorSelectors.length >= MAX_EDITOR_SELECTOR_COUNT) {
                isSelectorCapacityReached = true;
                return {};
            }
            excludedEditorSelectors.push(canonicalSelector);
            return { excludedEditorSelectors };
        });
        if (!updated) {
            return;
        }
        if (isSelectorCapacityReached) {
            reportStatus(
                environment,
                `Remove an existing selector before adding more than ${MAX_EDITOR_SELECTOR_COUNT}.`
            );
            return;
        }
        if (updated) {
            reportStatus(
                environment,
                isRemovingSelector
                    ? `Editor exclusion selector removed: ${canonicalSelector}`
                    : `Editor exclusion selector added: ${canonicalSelector}`
            );
        }
    });
};

export const registerSettingsMenu = (
    environment: SettingsMenuEnvironment,
    store: SettingsStore
): SettingsMenuController => {
    let editingCommandId: number | undefined;
    let toolbarCommandId: number | undefined;
    let hostnameCommandId: number | undefined;
    let hasEditingCommandRegistrationBeenAttempted = false;
    let hasToolbarCommandRegistrationBeenAttempted = false;
    let hasHostnameCommandRegistrationBeenAttempted = false;

    const refreshHostnameAction = (settings: MarkdownEnhancerSettings): void => {
        const hostname = getCurrentHostname(environment);
        if (hostnameCommandId !== undefined || !hasHostnameCommandRegistrationBeenAttempted) {
            hasHostnameCommandRegistrationBeenAttempted = true;
            const isHostnameExcluded = hostname ? settings.excludedHostnames.includes(hostname) : false;
            hostnameCommandId = registerMenuCommand(
                environment,
                hostname ? getHostnameActionLabel(settings, hostname) : "Exclude This Hostname",
                () => setCurrentHostnameExclusion(hostname, !isHostnameExcluded),
                hostnameCommandId
            );
        }
    };

    const refreshDynamicActions = (shouldRefreshHostname = true, shouldUseDefaultSettings = false): void => {
        let settings: MarkdownEnhancerSettings;
        try {
            settings = store.getSettings();
        } catch {
            if (!shouldUseDefaultSettings) {
                return;
            }
            settings = createDefaultSettings();
        }
        if (editingCommandId !== undefined || !hasEditingCommandRegistrationBeenAttempted) {
            hasEditingCommandRegistrationBeenAttempted = true;
            editingCommandId = registerMenuCommand(
                environment,
                getEditingActionLabel(settings),
                () => setMarkdownEditing(!settings.isEnabled),
                editingCommandId
            );
        }
        if (toolbarCommandId !== undefined || !hasToolbarCommandRegistrationBeenAttempted) {
            hasToolbarCommandRegistrationBeenAttempted = true;
            toolbarCommandId = registerMenuCommand(
                environment,
                getToolbarActionLabel(settings),
                () => setFormattingToolbar(!settings.isToolbarEnabled),
                toolbarCommandId
            );
        }
        if (shouldRefreshHostname) {
            refreshHostnameAction(settings);
        }
    };

    const setMarkdownEditing = (isEnabled: boolean): void => {
        applySettingsUpdate(environment, store, { isEnabled });
        refreshDynamicActions();
    };

    const setFormattingToolbar = (isToolbarEnabled: boolean): void => {
        applySettingsUpdate(environment, store, { isToolbarEnabled });
        refreshDynamicActions();
    };

    const setCurrentHostnameExclusion = (hostname: string | undefined, shouldExcludeHostname: boolean): void => {
        if (!canUpdateSettings(environment, store)) {
            return;
        }
        if (!hostname) {
            reportStatus(environment, "The current hostname is unavailable.");
            return;
        }
        const updated = applySettingsUpdate(environment, store, (settings) => {
            const hostnameIndex = settings.excludedHostnames.indexOf(hostname);
            const excludedHostnames = [...settings.excludedHostnames];
            if (shouldExcludeHostname && hostnameIndex < 0) {
                excludedHostnames.push(hostname);
            } else if (!shouldExcludeHostname && hostnameIndex >= 0) {
                excludedHostnames.splice(hostnameIndex, 1);
            }
            return { excludedHostnames };
        });
        if (updated) {
            reportStatus(
                environment,
                shouldExcludeHostname ? `${hostname} is now excluded.` : `${hostname} is now included.`
            );
        }
        refreshDynamicActions();
    };

    refreshDynamicActions(false, true);
    registerTabWidthAction(environment, store);
    registerBulletStyleAction(environment, store);
    registerShortcutAction(environment, store, "bold");
    registerShortcutAction(environment, store, "italic");
    registerShortcutAction(environment, store, "link");
    let hostnameSettings = createDefaultSettings();
    try {
        hostnameSettings = store.getSettings();
    } catch {
        // Preserve the canonical action position with safe default labeling.
    }
    refreshHostnameAction(hostnameSettings);
    registerEditorSelectorAction(environment, store);

    return { refresh: refreshDynamicActions };
};
