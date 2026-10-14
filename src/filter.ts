/** Inputs that must never be sent to Jev, with the reason for each. */
export function skipReason(text: string, source: string, minPromptLength: number): string | undefined {
	const trimmed = text.trim();
	if (source === "extension") return "sent by an extension";
	if (trimmed === "") return "empty";
	if (trimmed.startsWith("/")) return "slash command";
	if (trimmed.startsWith("!")) return "shell command";
	if (trimmed.length < minPromptLength) return "too short";
	return undefined;
}
