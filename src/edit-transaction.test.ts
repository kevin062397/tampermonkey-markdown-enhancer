import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { applyEditTransaction, isEditTransactionHandled } from "./edit-transaction";
import type { EditOperation } from "./editor-state";

const createTextArea = (value = "alpha"): HTMLTextAreaElement => {
    const textArea = document.createElement("textarea");
    textArea.value = value;
    textArea.setSelectionRange(1, 4, "backward");
    document.body.append(textArea);
    return textArea;
};

const createReplacement = (overrides: Partial<EditOperation> = {}): EditOperation => ({
    isTextReplacementRequired: true,
    replaceStart: 1,
    replaceEnd: 4,
    text: "X",
    selectionStart: 1,
    selectionEnd: 2,
    selectionDirection: "backward",
    ...overrides
});

const setExecCommand = (ownerDocument: Document, implementation: Document["execCommand"]): void => {
    Object.defineProperty(ownerDocument, "execCommand", {
        configurable: true,
        value: implementation
    });
};

beforeEach(() => {
    document.body.innerHTML = "";
});

afterEach(() => {
    delete (document as unknown as { execCommand?: Document["execCommand"] }).execCommand;
    vi.restoreAllMocks();
    document.body.innerHTML = "";
});

describe("Edit transaction", () => {
    test("applies one fallback input with the expected editor state", () => {
        const textArea = createTextArea();
        textArea.scrollTop = 12;
        textArea.scrollLeft = 4;
        const inputEvents: InputEvent[] = [];
        textArea.addEventListener("input", (event) => inputEvents.push(event as InputEvent));

        const outcome = applyEditTransaction(textArea, createReplacement());

        expect(outcome).toBe("applied");
        expect(isEditTransactionHandled(outcome)).toBe(true);
        expect(textArea.value).toBe("aXa");
        expect([textArea.selectionStart, textArea.selectionEnd, textArea.selectionDirection]).toEqual([
            1,
            2,
            "backward"
        ]);
        expect([textArea.scrollTop, textArea.scrollLeft]).toEqual([12, 4]);
        expect(inputEvents).toHaveLength(1);
        expect(inputEvents[0]).toMatchObject({
            bubbles: true,
            composed: true,
            data: "X",
            inputType: "insertText"
        });
    });

    test("uses the textarea owner document for one native transaction", () => {
        const frame = document.createElement("iframe");
        document.body.append(frame);
        const ownerDocument = frame.contentDocument;
        const ownerWindow = frame.contentWindow;
        if (!ownerDocument || !ownerWindow) {
            throw new Error("Expected iframe browsing context");
        }
        const textArea = ownerDocument.createElement("textarea");
        textArea.value = "alpha";
        textArea.setSelectionRange(1, 4);
        ownerDocument.body.append(textArea);
        const executeMainCommand = vi.fn(() => false);
        const executeOwnerCommand = vi.fn((_command: string, _showUi: boolean, value: string) => {
            textArea.setRangeText(value, textArea.selectionStart, textArea.selectionEnd, "select");
            textArea.dispatchEvent(
                new (ownerWindow as unknown as { InputEvent: typeof InputEvent }).InputEvent("input", {
                    bubbles: true,
                    composed: true,
                    data: value,
                    inputType: "insertText"
                })
            );
            return true;
        });
        setExecCommand(document, executeMainCommand);
        setExecCommand(ownerDocument, executeOwnerCommand);
        const handleInput = vi.fn();
        textArea.addEventListener("input", handleInput);

        const outcome = applyEditTransaction(textArea, createReplacement());

        expect(outcome).toBe("applied");
        expect(executeOwnerCommand).toHaveBeenCalledOnce();
        expect(executeMainCommand).not.toHaveBeenCalled();
        expect(handleInput).toHaveBeenCalledOnce();
        expect(textArea.value).toBe("aXa");
    });

    test.each([
        ["a missing command", undefined],
        ["a false command", (): boolean => false],
        [
            "a throwing command",
            (): boolean => {
                throw new Error("native insertion unavailable");
            }
        ],
        ["a false-success command", (): boolean => true]
    ] as const)("falls back exactly once after %s leaves the original value", (_caseName, executeCommand) => {
        const textArea = createTextArea();
        if (executeCommand) {
            setExecCommand(document, executeCommand as Document["execCommand"]);
        }
        const setRangeText = vi.spyOn(textArea, "setRangeText");
        const handleInput = vi.fn();
        textArea.addEventListener("input", handleInput);

        const outcome = applyEditTransaction(textArea, createReplacement());

        expect(outcome).toBe("applied");
        expect(setRangeText).toHaveBeenCalledOnce();
        expect(handleInput).toHaveBeenCalledOnce();
        expect(textArea.value).toBe("aXa");
    });

    test("accepts an expected native value even when the command reports false", () => {
        const textArea = createTextArea();
        const setRangeText = vi.spyOn(textArea, "setRangeText");
        const handleInput = vi.fn();
        textArea.addEventListener("input", handleInput);
        setExecCommand(
            document,
            vi.fn(() => {
                textArea.value = "aXa";
                return false;
            })
        );

        const outcome = applyEditTransaction(textArea, createReplacement());

        expect(outcome).toBe("applied");
        expect(setRangeText).not.toHaveBeenCalled();
        expect(handleInput).toHaveBeenCalledOnce();
        expect(textArea.value).toBe("aXa");
    });

    test("preserves an unexpected native value without applying a fallback", () => {
        const textArea = createTextArea();
        const setRangeText = vi.spyOn(textArea, "setRangeText");
        setExecCommand(
            document,
            vi.fn(() => {
                textArea.value = "page value";
                textArea.dispatchEvent(new InputEvent("input", { bubbles: true, composed: true }));
                return true;
            })
        );

        const outcome = applyEditTransaction(textArea, createReplacement());

        expect(outcome).toBe("page-controlled");
        expect(isEditTransactionHandled(outcome)).toBe(true);
        expect(setRangeText).not.toHaveBeenCalled();
        expect(textArea.value).toBe("page value");
    });

    test("does not replay a native edit reverted by a page input handler", () => {
        const textArea = createTextArea();
        const setRangeText = vi.spyOn(textArea, "setRangeText");
        textArea.addEventListener("input", () => {
            textArea.value = "alpha";
        });
        setExecCommand(
            document,
            vi.fn((_command, _showUi, value) => {
                textArea.value = `a${String(value)}a`;
                textArea.dispatchEvent(new InputEvent("input", { bubbles: true, composed: true }));
                return true;
            })
        );

        const outcome = applyEditTransaction(textArea, createReplacement());

        expect(outcome).toBe("page-controlled");
        expect(setRangeText).not.toHaveBeenCalled();
        expect(textArea.value).toBe("alpha");
    });

    test("does not replay a fallback edit changed by a page input handler", () => {
        const textArea = createTextArea();
        const setRangeText = vi.spyOn(textArea, "setRangeText");
        const handleInput = vi.fn(() => {
            textArea.value = "controlled value";
        });
        textArea.addEventListener("input", handleInput);

        const outcome = applyEditTransaction(textArea, createReplacement());

        expect(outcome).toBe("page-controlled");
        expect(setRangeText).toHaveBeenCalledOnce();
        expect(handleInput).toHaveBeenCalledOnce();
        expect(textArea.value).toBe("controlled value");
    });

    test("declines when both native and fallback insertion leave the original value", () => {
        const textArea = createTextArea();
        setExecCommand(
            document,
            vi.fn(() => false)
        );
        vi.spyOn(textArea, "setRangeText").mockImplementation(() => {
            throw new Error("fallback unavailable");
        });

        const outcome = applyEditTransaction(textArea, createReplacement());

        expect(outcome).toBe("declined");
        expect(isEditTransactionHandled(outcome)).toBe(false);
        expect(textArea.value).toBe("alpha");
    });

    test("applies selection-only operations without emitting input", () => {
        const textArea = createTextArea();
        const handleInput = vi.fn();
        textArea.addEventListener("input", handleInput);
        const operation = createReplacement({
            isTextReplacementRequired: false,
            replaceStart: 0,
            replaceEnd: 0,
            text: "",
            selectionStart: 4,
            selectionEnd: 4,
            selectionDirection: "none"
        });

        const outcome = applyEditTransaction(textArea, operation);

        expect(outcome).toBe("applied");
        expect(textArea.value).toBe("alpha");
        expect([textArea.selectionStart, textArea.selectionEnd, textArea.selectionDirection]).toEqual([4, 4, "none"]);
        expect(handleInput).not.toHaveBeenCalled();
    });

    test("declines an identical replacement with no selection change", () => {
        const textArea = createTextArea();
        const operation = createReplacement({
            replaceStart: 1,
            replaceEnd: 4,
            text: "lph",
            selectionStart: 1,
            selectionEnd: 4,
            selectionDirection: "backward"
        });
        const handleInput = vi.fn();
        textArea.addEventListener("input", handleInput);

        const outcome = applyEditTransaction(textArea, operation);

        expect(outcome).toBe("declined");
        expect(textArea.value).toBe("alpha");
        expect(handleInput).not.toHaveBeenCalled();
    });

    test("preserves a value changed by a page focus handler", () => {
        const textArea = createTextArea();
        const executeCommand = vi.fn(() => true);
        setExecCommand(document, executeCommand);
        vi.spyOn(textArea, "focus").mockImplementation(() => {
            textArea.value = "focused page value";
        });

        const outcome = applyEditTransaction(textArea, createReplacement());

        expect(outcome).toBe("page-controlled");
        expect(textArea.value).toBe("focused page value");
        expect(executeCommand).not.toHaveBeenCalled();
    });

    test("declines when the replacement selection cannot be prepared", () => {
        const textArea = createTextArea();
        const executeCommand = vi.fn(() => true);
        setExecCommand(document, executeCommand);
        vi.spyOn(textArea, "setSelectionRange").mockImplementation(() => {
            throw new Error("selection unavailable");
        });

        const outcome = applyEditTransaction(textArea, createReplacement());

        expect(outcome).toBe("declined");
        expect(textArea.value).toBe("alpha");
        expect(executeCommand).not.toHaveBeenCalled();
    });

    test("contains focus and input-dispatch failures after a verified fallback edit", () => {
        const textArea = createTextArea();
        vi.spyOn(textArea, "focus").mockImplementation(() => {
            throw new Error("focus unavailable");
        });
        vi.spyOn(textArea, "dispatchEvent").mockImplementation(() => {
            throw new Error("dispatch unavailable");
        });

        expect(() => applyEditTransaction(textArea, createReplacement())).not.toThrow();
        expect(textArea.value).toBe("aXa");
    });
});
