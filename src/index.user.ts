function main(): void {
    const selectors = ["textarea"].join(", ");

    const WRAP_CHARACTERS: Record<string, { leading: string; trailing: string; isSelectionRequired: boolean }> = {
        "(": { leading: "(", trailing: ")", isSelectionRequired: false },
        "[": { leading: "[", trailing: "]", isSelectionRequired: false },
        "{": { leading: "{", trailing: "}", isSelectionRequired: false },
        "<": { leading: "<", trailing: ">", isSelectionRequired: false },
        '"': { leading: '"', trailing: '"', isSelectionRequired: true },
        "'": { leading: "'", trailing: "'", isSelectionRequired: true },
        "`": { leading: "`", trailing: "`", isSelectionRequired: true },
        _: { leading: "_", trailing: "_", isSelectionRequired: true },
        "*": { leading: "*", trailing: "*", isSelectionRequired: true },
        "~": { leading: "~", trailing: "~", isSelectionRequired: true }
    };

    const TAB_SIZE = 4;

    // Helper to check if a string is a hyperlink (http/https/ftp/mailto)
    const isHyperlink = (text: string): boolean => {
        return /^(https?:\/\/|ftp:\/\/|mailto:)[^\s]+$/i.test(text.trim());
    };

    // Helper function to insert text while preserving undo history
    const insertTextWithUndo = (textArea: HTMLTextAreaElement, text: string, start: number, end: number): void => {
        textArea.focus();
        textArea.setSelectionRange(start, end);

        // Use execCommand for better undo support, fallback to setRangeText
        if (document.execCommand) {
            document.execCommand("insertText", false, text);
        } else {
            textArea.setRangeText(text, start, end, "select");
        }
    };

    const wrapSelectedText = (textArea: HTMLTextAreaElement, leading: string, trailing: string): void => {
        const start = textArea.selectionStart;
        const end = textArea.selectionEnd;
        const selectedText = textArea.value.slice(start, end);

        // Replace selection with wrapped text
        const newText = leading + selectedText + trailing;
        insertTextWithUndo(textArea, newText, start, end);

        // Reselect the original content (without wrapping chars)
        textArea.selectionStart = start + leading.length;
        textArea.selectionEnd = start + leading.length + selectedText.length;
    };

    const indentSelectedLines = (textArea: HTMLTextAreaElement, tabSize: number): void => {
        const start = textArea.selectionStart;
        const end = textArea.selectionEnd;
        const value = textArea.value;

        // Find line starts for selection
        const beforeSelection = value.slice(0, start);

        const selectionStartLine = beforeSelection.lastIndexOf("\n") + 1;
        const selectionEndLine = value.indexOf("\n", end) >= 0 ? value.indexOf("\n", end) : value.length; // The end index is exclusive, so it's before the next line break or before the end of text

        const selectedLines = value.slice(selectionStartLine, selectionEndLine).split("\n");

        // Add spaces to each selected line
        const indentedLines = selectedLines.map((line) => " ".repeat(tabSize) + line);

        const newText = indentedLines.join("\n");

        // Replace the selected lines with indented ones
        insertTextWithUndo(textArea, newText, selectionStartLine, selectionEndLine);

        // Update selection to cover the newly indented lines
        const addedChars = tabSize * selectedLines.length;
        textArea.selectionStart = start + tabSize;
        textArea.selectionEnd = end + addedChars;
    };

    const insertSpaces = (textArea: HTMLTextAreaElement, tabSize: number): void => {
        const start = textArea.selectionStart;
        const end = textArea.selectionEnd;
        const value = textArea.value;

        // Find the current line and calculate the number of spaces to insert
        const currentLine = value.slice(0, start).split("\n").pop() || "";
        const spacesToInsert = tabSize - (currentLine.length % tabSize); // Calculate the number of spaces to reach the next multiple of tab size
        const spaces = " ".repeat(spacesToInsert);

        // Insert spaces at the cursor position
        insertTextWithUndo(textArea, spaces, start, end);
        textArea.selectionStart = start + spacesToInsert;
        textArea.selectionEnd = start + spacesToInsert;
    };

    const outdentSelectedLines = (textArea: HTMLTextAreaElement, tabSize: number): void => {
        const start = textArea.selectionStart;
        const end = textArea.selectionEnd;
        const value = textArea.value;

        // Find line starts for selection
        const beforeSelection = value.slice(0, start);
        const selectionStartLine = beforeSelection.lastIndexOf("\n") + 1;
        const selectionEndLine = value.indexOf("\n", end) >= 0 ? value.indexOf("\n", end) : value.length; // The end index is exclusive, so it's before the next line break or before the end of text

        const selectedLines = value.slice(selectionStartLine, selectionEndLine).split("\n");

        // Remove up to tabSize spaces from each selected line
        const outdentedLines = selectedLines.map((line) =>
            line.startsWith(" ".repeat(tabSize)) ? line.slice(tabSize) : line.replace(/^ +/, "")
        );

        const newText = outdentedLines.join("\n");

        // Calculate how many spaces were actually removed
        let removedChars = 0;
        let removedCharsFirstLine = 0;
        selectedLines.forEach((line, i) => {
            const original = line;
            const outdented = outdentedLines[i];
            removedChars += original.length - outdented.length;
            if (i === 0) {
                removedCharsFirstLine = original.length - outdented.length;
            }
        });

        // Replace the selected lines with outdented ones
        insertTextWithUndo(textArea, newText, selectionStartLine, selectionEndLine);

        // Update selection to cover the newly outdented lines
        textArea.selectionStart = Math.max(start - removedCharsFirstLine, selectionStartLine); // Ensure selection doesn't go before the start of the line
        textArea.selectionEnd = Math.max(end - removedChars, selectionStartLine); // Ensure selection doesn't go before the start of the line
    };

    // Helper function to apply text replacement and set selection
    const applyWrapChange = (
        textArea: HTMLTextAreaElement,
        newStart: number,
        newEnd: number,
        oldStart: number,
        oldEnd: number,
        newText: string
    ): void => {
        insertTextWithUndo(textArea, newText, oldStart, oldEnd);
        textArea.selectionStart = newStart;
        textArea.selectionEnd = newEnd;
    };

    // Helper function to check if text is wrapped with specific pattern
    const isWrappedWith = (value: string, start: number, end: number, pattern: string): boolean => {
        const before = value.slice(start - pattern.length, start);
        const after = value.slice(end, end + pattern.length);
        return before === pattern && after === pattern;
    };

    // Handle markdown asterisk formatting
    const handleMarkdownToggle = (
        textArea: HTMLTextAreaElement,
        start: number,
        end: number,
        value: string,
        selectedText: string,
        wrap: string
    ): boolean => {
        // Check for triple asterisk case (***bold italic***)
        if (isWrappedWith(value, start, end, "***")) {
            const newWrap = wrap === "*" ? "**" : "*"; // Remove italic -> keep bold, Remove bold -> keep italic
            const newText = newWrap + selectedText + newWrap;
            const selectionOffset = wrap === "*" ? -1 : -2;
            const newStart = start + selectionOffset;
            const newEnd = newStart + selectedText.length;
            applyWrapChange(textArea, newStart, newEnd, start - 3, end + 3, newText);
            return true;
        }

        // Check for exact wrapping with target wrap
        if (isWrappedWith(value, start, end, wrap)) {
            // For single asterisk, make sure it's not part of double asterisks
            if (wrap === "*") {
                const beforeExtended = value.slice(start - 2, start);
                const afterExtended = value.slice(end, end + 2);
                if (beforeExtended === "**" || afterExtended === "**") {
                    return false; // Let it fall through to conversion logic
                }
            }
            // Remove the wrapping
            const newStart = start - wrap.length;
            const newEnd = newStart + selectedText.length;
            applyWrapChange(textArea, newStart, newEnd, start - wrap.length, end + wrap.length, selectedText);
            return true;
        }

        // Handle cross-format conversion (bold ↔ italic)
        const otherWrap = wrap === "*" ? "**" : "*";
        if (isWrappedWith(value, start, end, otherWrap)) {
            // Convert to bold+italic
            const newText = "***" + selectedText + "***";
            // Calculate new selection position based on the replacement
            // Original text is at position (start - otherWrap.length), new text starts with "***"
            const replacementStart = start - otherWrap.length;
            const newStart = replacementStart + 3; // Position after "***"
            const newEnd = newStart + selectedText.length;
            applyWrapChange(textArea, newStart, newEnd, start - otherWrap.length, end + otherWrap.length, newText);
            return true;
        }

        // Check if selection itself is wrapped
        if (selectedText.startsWith(wrap) && selectedText.endsWith(wrap) && selectedText.length >= wrap.length * 2) {
            const unwrapped = selectedText.slice(wrap.length, -wrap.length);
            insertTextWithUndo(textArea, unwrapped, start, end);
            textArea.selectionStart = start;
            textArea.selectionEnd = start + unwrapped.length;
            return true;
        }

        return false; // No special handling applied
    };

    // Handle non-markdown wrapping (parentheses, quotes, etc.)
    const handleGenericToggle = (
        textArea: HTMLTextAreaElement,
        start: number,
        end: number,
        value: string,
        selectedText: string,
        wrap: string
    ): boolean => {
        const wrapLen = wrap.length;

        if (isWrappedWith(value, start, end, wrap)) {
            // Remove wrapping from outside selection
            const newStart = start - wrapLen;
            const newEnd = newStart + selectedText.length;
            applyWrapChange(textArea, newStart, newEnd, start - wrapLen, end + wrapLen, selectedText);
            return true;
        }

        if (selectedText.startsWith(wrap) && selectedText.endsWith(wrap) && selectedText.length >= wrapLen * 2) {
            // Remove wrapping from inside selection
            const unwrapped = selectedText.slice(wrapLen, -wrapLen);
            insertTextWithUndo(textArea, unwrapped, start, end);
            textArea.selectionStart = start;
            textArea.selectionEnd = start + unwrapped.length;
            return true;
        }

        return false; // No special handling applied
    };

    const toggleWrap = (textArea: HTMLTextAreaElement, wrap: string): void => {
        const start = textArea.selectionStart;
        const end = textArea.selectionEnd;
        const value = textArea.value;
        const wrapLen = wrap.length;
        const selectedText = value.slice(start, end);

        // Try markdown-specific handling for asterisks
        if (wrap === "*" || wrap === "**") {
            if (handleMarkdownToggle(textArea, start, end, value, selectedText, wrap)) {
                return;
            }
        } else {
            // Try generic wrapping handling for other characters
            if (handleGenericToggle(textArea, start, end, value, selectedText, wrap)) {
                return;
            }
        }

        // If no special handling was applied, add wrapping
        const wrapped = wrap + selectedText + wrap;
        insertTextWithUndo(textArea, wrapped, start, end);
        textArea.selectionStart = start + wrapLen;
        textArea.selectionEnd = start + wrapLen + selectedText.length;
    };

    // Detect OS for modifier key
    const getOSModifierKey = (): "ctrl" | "meta" => {
        const platform = navigator.platform.toLowerCase();
        if (platform.includes("mac")) {
            // Command for macOS
            return "meta";
        }
        if (platform.includes("win")) {
            // Control for Windows
            return "ctrl";
        }
        // For Linux and others, use Control
        return "ctrl";
    };

    const osModifierKey = getOSModifierKey();

    const handleKeydown = (event: KeyboardEvent): void => {
        const textArea = event.target as HTMLTextAreaElement;

        const { selectionStart, selectionEnd } = textArea;
        const hasSelection = selectionStart !== selectionEnd;

        // OS-specific modifier logic
        const isModifierKey =
            (osModifierKey === "meta" && event.metaKey && !event.ctrlKey) ||
            (osModifierKey === "ctrl" && event.ctrlKey && !event.metaKey);
        // Toggle bold
        if (isModifierKey && event.key.toLowerCase() === "b") {
            event.preventDefault();
            if (hasSelection) {
                toggleWrap(textArea, "**");
            }
            return;
        }
        // Toggle italic
        if (isModifierKey && event.key.toLowerCase() === "i") {
            event.preventDefault();
            if (hasSelection) {
                toggleWrap(textArea, "*");
            }
            return;
        }

        // Handle wrapping characters
        if (event.key in WRAP_CHARACTERS) {
            const { leading, trailing, isSelectionRequired } = WRAP_CHARACTERS[event.key];

            if (hasSelection || !isSelectionRequired) {
                // If text is selected or wrapping is allowed without selection
                event.preventDefault();
                wrapSelectedText(textArea, leading, trailing);
            }
        }

        // Handle Tab for indentation
        if (event.key === "Tab" && !event.shiftKey) {
            event.preventDefault();

            if (hasSelection) {
                // If text is selected, indent the selected lines
                indentSelectedLines(textArea, TAB_SIZE);
            } else {
                // If no text is selected, insert spaces
                insertSpaces(textArea, TAB_SIZE);
            }
        }

        // Handle Shift+Tab for outdentation
        if (event.key === "Tab" && event.shiftKey) {
            event.preventDefault();
            outdentSelectedLines(textArea, TAB_SIZE);
        }
    };

    const handlePaste = (event: ClipboardEvent): void => {
        const textArea = event.target as HTMLTextAreaElement;

        // Only handle if clipboard has text
        if (!event.clipboardData) {
            return;
        }

        const pasteText = event.clipboardData.getData("text");

        const { selectionStart, selectionEnd } = textArea;
        const hasSelection = selectionStart !== selectionEnd;

        if (hasSelection && isHyperlink(pasteText)) {
            // If text is selected and clipboard content is a hyperlink
            event.preventDefault();
            const selectedText = textArea.value.slice(selectionStart, selectionEnd);
            const markdownLink = `[${selectedText}](${pasteText.trim()})`;
            insertTextWithUndo(textArea, markdownLink, selectionStart, selectionEnd);
            // Place cursor after the inserted link
            const newCursor = selectionStart + markdownLink.length;
            textArea.selectionStart = newCursor;
            textArea.selectionEnd = newCursor;
        }
        // Otherwise, allow default paste
    };

    const attachListener = (textArea: HTMLTextAreaElement): void => {
        if (textArea.dataset.markdownEnhancerAttached === "true") {
            return;
        }
        textArea.addEventListener("keydown", handleKeydown);
        textArea.addEventListener("paste", handlePaste);
        textArea.dataset.markdownEnhancerAttached = "true";
    };

    const attachListenerToAllTextAreas = (): void => {
        document.querySelectorAll<HTMLTextAreaElement>(selectors).forEach(attachListener);
    };

    // Run on page load
    attachListenerToAllTextAreas();

    // Observe future changes (for dynamically loaded content)
    const observer = new MutationObserver(() => {
        attachListenerToAllTextAreas();
    });
    observer.observe(document.body, {
        childList: true,
        subtree: true
    });
}

main();
