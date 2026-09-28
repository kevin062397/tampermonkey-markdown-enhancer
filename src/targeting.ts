export const isSupportedEditor = (target: EventTarget | null): target is HTMLTextAreaElement =>
    target instanceof HTMLTextAreaElement && !target.readOnly && !target.disabled;
