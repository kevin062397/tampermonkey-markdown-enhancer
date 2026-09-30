import { describe, expect, test } from "vitest";
import { getPrimaryModifierLabel, isMacPlatform } from "./platform";

const PLATFORM_CASES = [
    ["Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", true, "Command"],
    ["Mozilla/5.0 (Windows NT 10.0; Win64; x64)", false, "Control"],
    ["Mozilla/5.0 (X11; Linux x86_64)", false, "Control"],
    ["Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)", false, "Control"],
    ["Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X)", false, "Control"],
    ["Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) Mobile/15E148", false, "Control"]
] as const;

describe("Platform Modifiers", () => {
    test.each(PLATFORM_CASES)("classifies %s", (userAgent, isMacExpected, expectedLabel) => {
        expect(isMacPlatform(userAgent)).toBe(isMacExpected);
        expect(getPrimaryModifierLabel(userAgent)).toBe(expectedLabel);
    });
});
