import { describe, expect, it } from "vitest";
import { skipReason } from "../src/filter.ts";

describe("skipReason", () => {
	it("lets an ordinary prompt through", () => {
		expect(skipReason("search the web for pi release notes", "interactive", 8)).toBeUndefined();
	});

	it("skips slash and shell commands", () => {
		expect(skipReason("/ext status", "interactive", 8)).toBe("slash command");
		expect(skipReason("!ls -la", "interactive", 8)).toBe("shell command");
	});

	it("skips extension-generated input, empty text and short acknowledgements", () => {
		expect(skipReason("search the web", "extension", 8)).toBe("sent by an extension");
		expect(skipReason("   ", "interactive", 8)).toBe("empty");
		expect(skipReason("ok", "interactive", 8)).toBe("too short");
	});
});
