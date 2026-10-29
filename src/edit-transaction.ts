import type { EditOperation } from "./editor-state";

export type EditTransactionOutcome = "applied" | "page-controlled" | "declined";

const createExpectedValue = (value: string, operation: EditOperation): string =>
    operation.isTextReplacementRequired
        ? `${value.slice(0, operation.replaceStart)}${operation.text}${value.slice(operation.replaceEnd)}`
        : value;

const isInputFromTextArea = (event: Event, textArea: HTMLTextAreaElement): boolean => {
    try {
        return event.composedPath().includes(textArea);
    } catch {
        return event.target === textArea;
    }
};

const restoreEditorViewport = (textArea: HTMLTextAreaElement, scrollTop: number, scrollLeft: number): void => {
    try {
        textArea.scrollTop = scrollTop;
        textArea.scrollLeft = scrollLeft;
    } catch {
        // A page-owned editor must not turn viewport restoration into an unhandled transaction failure.
    }
};

const applyFinalSelection = (textArea: HTMLTextAreaElement, operation: EditOperation): boolean => {
    try {
        textArea.setSelectionRange(operation.selectionStart, operation.selectionEnd, operation.selectionDirection);
        return (
            textArea.selectionStart === operation.selectionStart &&
            textArea.selectionEnd === operation.selectionEnd &&
            textArea.selectionDirection === operation.selectionDirection
        );
    } catch {
        return false;
    }
};

const createFallbackInputEvent = (textArea: HTMLTextAreaElement, text: string): InputEvent => {
    const InputEventConstructor = textArea.ownerDocument.defaultView?.InputEvent ?? InputEvent;
    return new InputEventConstructor("input", {
        bubbles: true,
        composed: true,
        data: text,
        inputType: "insertText"
    });
};

export const isEditTransactionHandled = (outcome: EditTransactionOutcome): boolean => outcome !== "declined";

export const applyEditTransaction = (
    textArea: HTMLTextAreaElement,
    operation: EditOperation
): EditTransactionOutcome => {
    const originalValue = textArea.value;
    const originalSelectionStart = textArea.selectionStart;
    const originalSelectionEnd = textArea.selectionEnd;
    const originalSelectionDirection = textArea.selectionDirection;
    const expectedValue = createExpectedValue(originalValue, operation);
    const scrollTop = textArea.scrollTop;
    const scrollLeft = textArea.scrollLeft;
    const restoreViewport = (): void => restoreEditorViewport(textArea, scrollTop, scrollLeft);

    try {
        textArea.focus();
    } catch {
        // Fallback insertion can still succeed when a page-owned focus method is unavailable.
    }

    if (textArea.value !== originalValue) {
        restoreViewport();
        return "page-controlled";
    }

    if (!operation.isTextReplacementRequired || expectedValue === originalValue) {
        const isSelectionApplied = applyFinalSelection(textArea, operation);
        restoreViewport();
        const isSelectionChanged =
            originalSelectionStart !== operation.selectionStart ||
            originalSelectionEnd !== operation.selectionEnd ||
            originalSelectionDirection !== operation.selectionDirection;
        return isSelectionApplied && (isSelectionChanged || !operation.isTextReplacementRequired)
            ? "applied"
            : "declined";
    }

    try {
        textArea.setSelectionRange(operation.replaceStart, operation.replaceEnd);
    } catch {
        restoreViewport();
        return textArea.value === originalValue ? "declined" : "page-controlled";
    }

    const ownerDocument = textArea.ownerDocument;
    let hasObservedNativeInput = false;
    let isNativeInputListenerAttached = false;
    const handleNativeInput = (event: Event): void => {
        if (isInputFromTextArea(event, textArea)) {
            hasObservedNativeInput = true;
        }
    };

    try {
        ownerDocument.addEventListener("input", handleNativeInput, true);
        isNativeInputListenerAttached = true;
    } catch {
        // Final-value verification remains available without temporary input observation.
    }

    let isNativeCommandReportedSuccessful = false;
    try {
        const executeCommand = ownerDocument.execCommand;
        if (typeof executeCommand === "function") {
            isNativeCommandReportedSuccessful = executeCommand.call(ownerDocument, "insertText", false, operation.text);
        }
    } catch {
        isNativeCommandReportedSuccessful = false;
    } finally {
        if (isNativeInputListenerAttached) {
            try {
                ownerDocument.removeEventListener("input", handleNativeInput, true);
            } catch {
                // A page-owned listener override must not escape the transaction boundary.
            }
        }
    }

    if (textArea.value === expectedValue) {
        if (!hasObservedNativeInput && isNativeInputListenerAttached) {
            try {
                textArea.dispatchEvent(createFallbackInputEvent(textArea, operation.text));
            } catch {
                // The verified text edit remains authoritative when page event delivery is unavailable.
            }
            if (textArea.value !== expectedValue) {
                restoreViewport();
                return "page-controlled";
            }
        }
        applyFinalSelection(textArea, operation);
        restoreViewport();
        return "applied";
    }
    if (
        textArea.value !== originalValue ||
        hasObservedNativeInput ||
        (isNativeCommandReportedSuccessful && !isNativeInputListenerAttached)
    ) {
        restoreViewport();
        return "page-controlled";
    }

    try {
        textArea.setRangeText(operation.text, operation.replaceStart, operation.replaceEnd, "select");
    } catch {
        restoreViewport();
        return textArea.value === originalValue ? "declined" : "page-controlled";
    }

    if (textArea.value !== expectedValue) {
        restoreViewport();
        return textArea.value === originalValue ? "declined" : "page-controlled";
    }

    try {
        textArea.dispatchEvent(createFallbackInputEvent(textArea, operation.text));
    } catch {
        // The verified text edit remains authoritative when page event delivery is unavailable.
    }

    if (textArea.value !== expectedValue) {
        restoreViewport();
        return "page-controlled";
    }

    applyFinalSelection(textArea, operation);
    restoreViewport();
    return "applied";
};
