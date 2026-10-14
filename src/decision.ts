import { NONE_OPTION } from "./catalog.ts";
import type { JevChoiceAnswer } from "./jev.ts";

/**
 * Turn Jev's probabilities into the list of extensions to activate.
 *
 * Probability, not the summary `confidence`, is the gate: a prompt that needs both
 * web search and a page fetch splits its mass between two options and would look
 * "unsure" to a confidence threshold, yet both activations are right.
 */
export function chooseActivations(
	answer: JevChoiceAnswer,
	minProbability: number,
	maxActivations: number,
): string[] {
	const ranked = Object.entries(answer.probabilities)
		.filter(([name, probability]) => name !== NONE_OPTION && probability >= minProbability)
		.sort((left, right) => right[1] - left[1]);

	return ranked.slice(0, Math.max(0, maxActivations)).map(([name]) => name);
}
