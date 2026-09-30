export type PrimaryModifierLabel = "Command" | "Control";

export const isMacPlatform = (userAgent: string = navigator.userAgent): boolean =>
    !/iPhone|iPad|iPod|Mobile/i.test(userAgent) && /Macintosh|Mac OS X/i.test(userAgent);

export const getPrimaryModifierLabel = (userAgent: string = navigator.userAgent): PrimaryModifierLabel =>
    isMacPlatform(userAgent) ? "Command" : "Control";
