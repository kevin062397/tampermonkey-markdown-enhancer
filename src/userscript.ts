import { getPrimaryModifierLabel, type PrimaryModifierLabel } from "./platform";
import { initializeMarkdownEnhancer } from "./runtime";
import { createSettingsStore, type MarkdownEnhancerSettings } from "./settings";
import { registerSettingsMenu } from "./settings-menu";
import { createDefaultEditorAdapters } from "./targeting";

export interface UserscriptEnvironment {
    readonly readValue: (key: string) => unknown;
    readonly writeValue: (key: string, value: MarkdownEnhancerSettings) => void;
    readonly registerCommand: (label: string, callback: () => void, existingCommandId?: number) => unknown;
    readonly requestInput: (prompt: string, currentValue: string) => string | null;
    readonly getPrimaryModifierLabel: () => PrimaryModifierLabel;
    readonly getPageUrl: () => URL;
    readonly isTopFrame: boolean;
}

export const createDefaultUserscriptEnvironment = (): UserscriptEnvironment => ({
    readValue: (key) => GM_getValue(key),
    writeValue: (key, value) => GM_setValue(key, value),
    registerCommand: (label, callback, existingCommandId) =>
        existingCommandId === undefined
            ? GM_registerMenuCommand(label, callback)
            : GM_registerMenuCommand(label, callback, { id: existingCommandId }),
    requestInput: (prompt, currentValue) => window.prompt(prompt, currentValue),
    getPrimaryModifierLabel,
    getPageUrl: () => new URL(window.location.href),
    isTopFrame: window.top === window
});

export const initializeUserscript = (
    environment: UserscriptEnvironment = createDefaultUserscriptEnvironment()
): (() => void) => {
    const settingsStore = createSettingsStore(environment);
    let refreshSettingsMenu: (() => void) | undefined;
    let isFocusListenerAttached = false;

    const removeFocusListener = (): void => {
        if (!isFocusListenerAttached || !refreshSettingsMenu) {
            return;
        }
        window.removeEventListener("focus", refreshSettingsMenu);
        isFocusListenerAttached = false;
    };

    if (environment.isTopFrame) {
        try {
            refreshSettingsMenu = registerSettingsMenu(environment, settingsStore).refresh;
            isFocusListenerAttached = true;
            window.addEventListener("focus", refreshSettingsMenu);
        } catch {
            try {
                removeFocusListener();
            } catch {
                // Keep the editor runtime independent from optional browser menu integration.
            }
        }
    }

    let disposeRuntime: () => void;
    try {
        const adapters = createDefaultEditorAdapters(settingsStore);
        disposeRuntime = initializeMarkdownEnhancer([], adapters, environment.getPageUrl, settingsStore);
    } catch (error) {
        try {
            removeFocusListener();
        } catch {
            // Preserve the runtime initialization failure when listener cleanup is unavailable.
        }
        throw error;
    }

    return () => {
        try {
            removeFocusListener();
        } catch {
            // Continue disposing the runtime when browser listener cleanup fails.
        }
        try {
            disposeRuntime();
        } catch {
            // Listener and runtime disposal remain independent.
        }
    };
};
