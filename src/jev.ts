export const JEV_ENDPOINT = "https://openrouter.ai/api/alpha/decisions";

export interface JevChoiceAnswer {
	choice: string;
	probabilities: Record<string, number>;
	confidence: number;
}

export interface JevDecision {
	answer: JevChoiceAnswer;
	costUsd: number;
	elapsedMs: number;
}

export interface JevRequestOptions {
	apiKey: string;
	model: string;
	timeoutMs: number;
	fetchImpl?: typeof fetch;
}

/** The body Jev receives. Exported so a test can check exactly what leaves the machine. */
export function buildRequestBody(prompt: string, options: Record<string, string>, model: string): object {
	return {
		model,
		// Only providers that neither train on nor retain prompts; OpenRouter refuses otherwise.
		provider: { data_collection: "deny", zdr: true },
		state: prompt,
		questions: {
			extension: {
				type: "choice",
				instructions:
					"The state is a request a user just typed to a coding agent. Which optional extension does the agent need to load to fulfil it? Pick the extension whose tools the request needs. Pick none when the built-in file and shell tools suffice or when the request is conversation.",
				criteria: options,
			},
		},
	};
}

export function parseDecision(payload: unknown): JevChoiceAnswer {
	const answer = (payload as { answers?: { extension?: Partial<JevChoiceAnswer> } })?.answers?.extension;
	if (!answer || typeof answer.choice !== "string" || typeof answer.probabilities !== "object") {
		throw new Error(
			`jev-ext-router: unexpected Jev response shape: ${JSON.stringify(payload).slice(0, 300)}`,
		);
	}
	return {
		choice: answer.choice,
		probabilities: answer.probabilities as Record<string, number>,
		confidence: typeof answer.confidence === "number" ? answer.confidence : 0,
	};
}

/** Ask Jev which extension the prompt needs. Throws on timeout, HTTP error, or a malformed reply. */
export async function askJev(
	prompt: string,
	options: Record<string, string>,
	request: JevRequestOptions,
): Promise<JevDecision> {
	const fetchImpl = request.fetchImpl ?? fetch;
	const started = Date.now();

	const response = await fetchImpl(JEV_ENDPOINT, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${request.apiKey}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify(buildRequestBody(prompt, options, request.model)),
		signal: AbortSignal.timeout(request.timeoutMs),
	});

	const text = await response.text();
	if (!response.ok) {
		throw new Error(`jev-ext-router: Jev returned HTTP ${response.status}: ${text.slice(0, 300)}`);
	}

	const payload = JSON.parse(text) as { usage?: { cost?: number } };
	return {
		answer: parseDecision(payload),
		costUsd: payload.usage?.cost ?? 0,
		elapsedMs: Date.now() - started,
	};
}
