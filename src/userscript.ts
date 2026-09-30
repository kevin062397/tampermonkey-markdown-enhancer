import { getPrimaryModifierLabel, type PrimaryModifierLabel } from "./platform";
import { initializeMarkdownEnhancer } from "./runtime";
import { createSettingsStore, type MarkdownEnhancerSettings } from "./settings";
import { registerSettingsMenu } from "./settings-menu";
import { createDefaultEditorAdapters } from "./targeting";

export interface UserscriptEnvironment {
    readonly readValue: (key: string) => unknown;
    readonly writeValue: (key: string, value: MarkdownEnhancerSettings) => void;
    readonly registerCommand: (label: string, callback: () => void) => void;
    readonly requestInput: (prompt: string, currentValue: string) => string | null;
    readonly getPrimaryModifierLabel: () => PrimaryModifierLabel;
    readonly getPageUrl: () => URL;
    readonly isTopFrame: boolean;
}

export const createDefaultUserscriptEnvironment = (): UserscriptEnvironment => ({
    readValue: (key) => GM_getValue(key),
    writeValue: (key, value) => GM_setValue(key, value),
    registerCommand: (label, callback) => {
        GM_registerMenuCommand(label, callback);
    },
    requestInput: (prompt, currentValue) => window.prompt(prompt, currentValue),
    getPrimaryModifierLabel,
    getPageUrl: () => new URL(window.location.href),
    isTopFrame: window.top === window
});

export const initializeUserscript = (
    environment: UserscriptEnvironment = createDefaultUserscriptEnvironment()
): (() => void) => {
    const settingsStore = createSettingsStore(environment);
    if (environment.isTopFrame) {
        registerSettingsMenu(environment, settingsStore);
    }
    const adapters = createDefaultEditorAdapters(settingsStore);
    return initializeMarkdownEnhancer([], adapters, environment.getPageUrl, settingsStore);
};
