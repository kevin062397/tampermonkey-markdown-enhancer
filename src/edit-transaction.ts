import type { EditOperation } from "./editor-state";

export const applyEditTransaction = (textArea: HTMLTextAreaElement, operation: EditOperation): void => {
    const scrollTop = textArea.scrollTop;
    const scrollLeft = textArea.scrollLeft;

    textArea.focus();
    if (operation.isTextReplacementRequired) {
        textArea.setSelectionRange(operation.replaceStart, operation.replaceEnd);
        const isNativeTransactionUsed =
            typeof document.execCommand === "function" && document.execCommand("insertText", false, operation.text);
        if (!isNativeTransactionUsed) {
            textArea.setRangeText(operation.text, operation.replaceStart, operation.replaceEnd, "select");
            textArea.dispatchEvent(
                new InputEvent("input", {
                    bubbles: true,
                    composed: true,
                    data: operation.text,
                    inputType: "insertText"
                })
            );
        }
    }

    textArea.setSelectionRange(operation.selectionStart, operation.selectionEnd, operation.selectionDirection);
    textArea.scrollTop = scrollTop;
    textArea.scrollLeft = scrollLeft;
};
