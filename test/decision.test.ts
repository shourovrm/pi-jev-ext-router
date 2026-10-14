import { describe, expect, it } from "vitest";
import { chooseActivations } from "../src/decision.ts";

describe("chooseActivations", () => {
	it("activates every extension at or above the probability gate, best first", () => {
		const answer = {
			choice: "web",
			confidence: 0.5,
			probabilities: { web: 0.5, fetch: 0.4, fusion: 0.05, none: 0.05 },
		};
		expect(chooseActivations(answer, 0.35, 2)).toEqual(["web", "fetch"]);
	});

	it("never activates the none option even when it wins", () => {
		const answer = { choice: "none", confidence: 1, probabilities: { none: 0.9, web: 0.1 } };
		expect(chooseActivations(answer, 0.35, 2)).toEqual([]);
	});

	it("caps the number of activations", () => {
		const answer = {
			choice: "a",
			confidence: 0.4,
			probabilities: { a: 0.4, b: 0.36, c: 0.35, none: 0 },
		};
		expect(chooseActivations(answer, 0.35, 1)).toEqual(["a"]);
	});
});
