export interface PairedCharacterDefinition {
    readonly leading: string;
    readonly trailing: string;
    readonly isSelectionRequired: boolean;
}

export const PAIRED_CHARACTERS: Readonly<Record<string, PairedCharacterDefinition>> = {
    "(": { leading: "(", trailing: ")", isSelectionRequired: false },
    "[": { leading: "[", trailing: "]", isSelectionRequired: false },
    "{": { leading: "{", trailing: "}", isSelectionRequired: false },
    "<": { leading: "<", trailing: ">", isSelectionRequired: false },
    '"': { leading: '"', trailing: '"', isSelectionRequired: true },
    "'": { leading: "'", trailing: "'", isSelectionRequired: true },
    "`": { leading: "`", trailing: "`", isSelectionRequired: true }
};

const pairDefinitions = Object.values(PAIRED_CHARACTERS);
const closingCharacters = new Set(pairDefinitions.map(({ trailing }) => trailing));
const asymmetricClosingCharacters = new Set(
    pairDefinitions.filter(({ leading, trailing }) => leading !== trailing).map(({ trailing }) => trailing)
);

export const isClosingPairCharacter = (character: string): boolean => closingCharacters.has(character);

export const isEmptyCharacterPair = (leading: string, trailing: string): boolean =>
    PAIRED_CHARACTERS[leading]?.trailing === trailing;

export const isCharacterEscaped = (value: string, index: number): boolean => {
    let backslashCount = 0;
    for (let position = index - 1; position >= 0 && value[position] === "\\"; position -= 1) {
        backslashCount += 1;
    }
    return backslashCount % 2 === 1;
};

const getPreviousCodePoint = (value: string, index: number): string | undefined =>
    Array.from(value.slice(0, index)).pop();

const getNextCodePoint = (value: string, index: number): string | undefined => Array.from(value.slice(index + 1))[0];

const isWordCharacter = (character: string | undefined): boolean =>
    Boolean(character && /[\p{L}\p{M}\p{N}_]/u.test(character));

const isApostropheWithinWord = (value: string, index: number): boolean =>
    value[index] === "'" &&
    isWordCharacter(getPreviousCodePoint(value, index)) &&
    isWordCharacter(getNextCodePoint(value, index));

export const isClosingPairMatched = (value: string, index: number, closing: string): boolean => {
    const pair = pairDefinitions.find(({ trailing }) => trailing === closing);
    if (!pair || isCharacterEscaped(value, index)) {
        return false;
    }
    if (pair.leading === pair.trailing) {
        if (closing === "'" && isApostropheWithinWord(value, index)) {
            return false;
        }
        let markerCount = 0;
        for (let position = 0; position < index; position += 1) {
            if (
                value[position] === pair.leading &&
                !isCharacterEscaped(value, position) &&
                !(pair.leading === "'" && isApostropheWithinWord(value, position))
            ) {
                markerCount += 1;
            }
        }
        return markerCount % 2 === 1;
    }

    const expectedClosers: string[] = [];
    for (let position = 0; position < index; position += 1) {
        if (isCharacterEscaped(value, position)) {
            continue;
        }
        const openingPair = PAIRED_CHARACTERS[value[position]];
        if (openingPair && openingPair.leading !== openingPair.trailing) {
            expectedClosers.push(openingPair.trailing);
        } else if (
            asymmetricClosingCharacters.has(value[position]) &&
            expectedClosers[expectedClosers.length - 1] === value[position]
        ) {
            expectedClosers.pop();
        }
    }
    return expectedClosers[expectedClosers.length - 1] === closing;
};
