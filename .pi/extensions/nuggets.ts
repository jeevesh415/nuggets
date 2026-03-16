/**
 * Nuggets Extension — Persistent holographic memory for pi
 *
 * Provides cross-session memory via the nuggets TypeScript library (HRR-backed storage).
 *
 * Features:
 * - LLM-callable `nuggets` tool (remember/recall/forget/list)
 * - System prompt injection of preferences & learnings
 * - Auto-capture of file paths from tool results
 * - Preference extraction from user input
 * - Context-aware compaction summaries
 * - State reconstruction from session history
 */

import { StringEnum } from "@mariozechner/pi-ai";
import type { ExtensionAPI, ExtensionContext, Theme } from "@mariozechner/pi-coding-agent";
import { matchesKey, Text, truncateToWidth } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";
import { NuggetShelf, promoteFacts } from "../../src/nuggets/index.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Fact {
	key: string;
	value: string;
}

interface NuggetsDetails {
	action: "remember" | "recall" | "forget" | "list";
	facts: Record<string, string>;
	error?: string;
}

// ---------------------------------------------------------------------------
// Shelf instance — direct library access (no CLI bridge)
// ---------------------------------------------------------------------------

const shelf = new NuggetShelf();
shelf.loadAll();

function shelfRemember(nuggetName: string, key: string, value: string): void {
	const nugget = shelf.getOrCreate(nuggetName);
	nugget.remember(key, value);
}

function shelfRecall(query: string, nuggetName?: string, sessionId = ""): {
	found: boolean;
	answer: string | null;
	confidence: number;
	nugget_name: string | null;
	margin: number;
} {
	return shelf.recall(query, nuggetName, sessionId);
}

function shelfForget(nuggetName: string, key: string): boolean {
	try {
		return shelf.get(nuggetName).forget(key);
	} catch {
		return false;
	}
}

function shelfFacts(nuggetName: string): Fact[] {
	try {
		return shelf.get(nuggetName).facts().map((f) => ({ key: f.key, value: f.value }));
	} catch {
		return [];
	}
}

// ---------------------------------------------------------------------------
// In-memory session state (for session-only tracking + system prompt injection)
// ---------------------------------------------------------------------------

let facts: Map<string, string> = new Map();

function factsToRecord(): Record<string, string> {
	return Object.fromEntries(facts);
}

function factsToList(): Fact[] {
	return [...facts.entries()].map(([key, value]) => ({ key, value }));
}

// ---------------------------------------------------------------------------
// Preference extraction
// ---------------------------------------------------------------------------

const PREF_PATTERNS = [
	{ regex: /\balways use (\w[\w\s]*\w|\w+)\b/i, prefix: "pref:always" },
	{ regex: /\bI prefer (\w[\w\s]*\w|\w+)\b/i, prefix: "pref:prefer" },
	{ regex: /\bnever (?:use )?(\w[\w\s]*\w|\w+)\b/i, prefix: "pref:never" },
	{ regex: /\bremember that (.+)/i, prefix: "learn" },
];

function extractPreference(text: string): { key: string; value: string } | null {
	for (const { regex, prefix } of PREF_PATTERNS) {
		const match = text.match(regex);
		if (match && match[1]) {
			const value = match[1].trim().slice(0, 100);
			const shortKey = value.slice(0, 30).replace(/\s+/g, "-").toLowerCase();
			return { key: `${prefix}:${shortKey}`, value };
		}
	}
	return null;
}

// ---------------------------------------------------------------------------
// System prompt formatting
// ---------------------------------------------------------------------------

function buildInjection(allFacts: Fact[]): string {
	if (allFacts.length === 0) return "";

	const preferences = allFacts.filter((f) => f.key.startsWith("pref:"));
	const learnings = allFacts.filter((f) => f.key.startsWith("learn"));
	const files = allFacts.filter((f) => f.key.startsWith("file:") || f.key.startsWith("edited:"));
	const other = allFacts.filter(
		(f) =>
			!f.key.startsWith("pref:") &&
			!f.key.startsWith("learn") &&
			!f.key.startsWith("file:") &&
			!f.key.startsWith("edited:") &&
			!f.key.startsWith("_"),
	);

	let injection = "\n\n## Nuggets — Persistent Memory\n";

	if (preferences.length) {
		injection += "\n### Preferences\n";
		injection += preferences.map((f) => `- ${f.key.replace(/^pref:/, "")}: ${f.value}`).join("\n");
	}

	if (learnings.length) {
		injection += "\n### Learnings\n";
		injection += learnings.map((f) => `- ${f.key.replace(/^learn:?/, "")}: ${f.value}`).join("\n");
	}

	if (files.length) {
		injection += "\n### Active Files\n";
		injection += files
			.slice(-10)
			.map((f) => `- ${f.value}`)
			.join("\n");
	}

	if (other.length) {
		injection += "\n### Facts\n";
		injection += other.map((f) => `- ${f.key}: ${f.value}`).join("\n");
	}

	return injection;
}

// ---------------------------------------------------------------------------
// Extension entry point
// ---------------------------------------------------------------------------

const NuggetsParams = Type.Object({
	action: StringEnum(["remember", "recall", "forget", "list"] as const),
	key: Type.Optional(Type.String({ description: "Fact key (for remember/forget)" })),
	value: Type.Optional(Type.String({ description: "Fact value (for remember)" })),
	query: Type.Optional(Type.String({ description: "Search query (for recall)" })),
});

export default function (pi: ExtensionAPI) {
	// -------------------------------------------------------------------
	// State reconstruction from session history
	// -------------------------------------------------------------------

	const reconstructState = (ctx: ExtensionContext) => {
		facts = new Map();

		for (const entry of ctx.sessionManager.getBranch()) {
			if (entry.type !== "message") continue;
			const msg = entry.message;
			if (msg.role !== "toolResult" || msg.toolName !== "nuggets") continue;

			const details = msg.details as NuggetsDetails | undefined;
			if (details?.facts) {
				for (const [k, v] of Object.entries(details.facts)) {
					if (v) {
						facts.set(k, v);
					} else {
						facts.delete(k);
					}
				}
			}
		}
	};

	// Reconstruct on all session lifecycle events
	pi.on("session_start", async (_event, ctx) => {
		reconstructState(ctx);

		// Hydrate from shelf (cross-session facts)
		const shelfFactsList = shelfFacts("memory");
		for (const f of shelfFactsList) {
			if (!facts.has(f.key)) {
				facts.set(f.key, f.value);
			}
		}
	});

	pi.on("session_switch", async (_event, ctx) => reconstructState(ctx));
	pi.on("session_fork", async (_event, ctx) => reconstructState(ctx));
	pi.on("session_tree", async (_event, ctx) => reconstructState(ctx));

	// -------------------------------------------------------------------
	// Register the nuggets tool — LLM calls this directly
	// -------------------------------------------------------------------

	pi.registerTool({
		name: "nuggets",
		label: "Nuggets Memory",
		description:
			"Persistent memory that survives across sessions. " +
			"Actions: remember (key + value), recall (query), forget (key), list. " +
			"Use to store preferences, learnings, file locations, commands, and patterns.",
		promptSnippet: "nuggets: store and retrieve persistent facts across sessions",
		promptGuidelines: [
			"Use nuggets to remember useful discoveries (file paths, patterns, commands)",
			"Before searching for something, recall from nuggets first",
			"Store user preferences when they say 'always', 'prefer', or 'never'",
			"Keep values short — one sentence max",
		],
		parameters: NuggetsParams,

		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			switch (params.action) {
				case "remember": {
					if (!params.key || !params.value) {
						return {
							content: [{ type: "text", text: "Error: key and value required for remember" }],
							details: { action: "remember", facts: factsToRecord(), error: "key and value required" } as NuggetsDetails,
							isError: true,
						};
					}

					facts.set(params.key, params.value);
					shelfRemember("memory", params.key, params.value);

					return {
						content: [{ type: "text", text: `Remembered: ${params.key} = ${params.value}` }],
						details: { action: "remember", facts: factsToRecord() } as NuggetsDetails,
					};
				}

				case "recall": {
					const query = params.query || params.key || "";
					if (!query) {
						return {
							content: [{ type: "text", text: "Error: query required for recall" }],
							details: { action: "recall", facts: factsToRecord(), error: "query required" } as NuggetsDetails,
							isError: true,
						};
					}

					// HRR-backed recall via shelf
					const result = shelfRecall(query);
					if (result.found && result.answer) {
						return {
							content: [
								{
									type: "text",
									text: `${result.answer}\n[confidence=${result.confidence.toFixed(3)}, source=${result.nugget_name || "memory"}]`,
								},
							],
							details: { action: "recall", facts: factsToRecord() } as NuggetsDetails,
						};
					}

					// Fallback: search in-memory facts
					const queryLower = query.toLowerCase();
					const matches = [...facts.entries()].filter(
						([k, v]) => k.toLowerCase().includes(queryLower) || v.toLowerCase().includes(queryLower),
					);

					if (matches.length === 0) {
						return {
							content: [{ type: "text", text: `No facts found for: ${query}` }],
							details: { action: "recall", facts: factsToRecord() } as NuggetsDetails,
						};
					}

					const text = matches.map(([k, v]) => `- ${k}: ${v}`).join("\n");
					return {
						content: [{ type: "text", text }],
						details: { action: "recall", facts: factsToRecord() } as NuggetsDetails,
					};
				}

				case "forget": {
					if (!params.key) {
						return {
							content: [{ type: "text", text: "Error: key required for forget" }],
							details: { action: "forget", facts: factsToRecord(), error: "key required" } as NuggetsDetails,
							isError: true,
						};
					}

					const existed = facts.delete(params.key);
					shelfForget("memory", params.key);

					return {
						content: [{ type: "text", text: existed ? `Forgot: ${params.key}` : `Key not found: ${params.key}` }],
						details: { action: "forget", facts: factsToRecord() } as NuggetsDetails,
					};
				}

				case "list": {
					const allFacts = factsToList();
					if (allFacts.length === 0) {
						return {
							content: [{ type: "text", text: "No facts stored" }],
							details: { action: "list", facts: factsToRecord() } as NuggetsDetails,
						};
					}

					const text = allFacts.map((f) => `- ${f.key}: ${f.value}`).join("\n");
					return {
						content: [{ type: "text", text: `${allFacts.length} facts:\n${text}` }],
						details: { action: "list", facts: factsToRecord() } as NuggetsDetails,
					};
				}

				default:
					return {
						content: [{ type: "text", text: `Unknown action: ${params.action}` }],
						details: { action: "list", facts: factsToRecord(), error: `unknown: ${params.action}` } as NuggetsDetails,
						isError: true,
					};
			}
		},

		renderCall(args, theme) {
			let text = theme.fg("toolTitle", theme.bold("nuggets ")) + theme.fg("muted", args.action);
			if (args.key) text += ` ${theme.fg("accent", args.key)}`;
			if (args.value) text += ` ${theme.fg("dim", `"${args.value}"`)}`;
			if (args.query) text += ` ${theme.fg("dim", `"${args.query}"`)}`;
			return new Text(text, 0, 0);
		},

		renderResult(result, { expanded }, theme) {
			const details = result.details as NuggetsDetails | undefined;

			if (details?.error) {
				return new Text(theme.fg("error", `Error: ${details.error}`), 0, 0);
			}

			if (!details) {
				const text = result.content[0];
				return new Text(text?.type === "text" ? text.text : "", 0, 0);
			}

			const factCount = Object.keys(details.facts).length;

			switch (details.action) {
				case "remember":
					return new Text(theme.fg("success", "\u2713 ") + theme.fg("muted", `Stored (${factCount} facts total)`), 0, 0);

				case "recall": {
					const text = result.content[0];
					const content = text?.type === "text" ? text.text : "No results";
					if (!expanded && content.length > 80) {
						return new Text(theme.fg("muted", content.slice(0, 80) + "..."), 0, 0);
					}
					return new Text(theme.fg("muted", content), 0, 0);
				}

				case "forget":
					return new Text(theme.fg("success", "\u2713 ") + theme.fg("muted", `Removed (${factCount} facts remaining)`), 0, 0);

				case "list": {
					const summary = theme.fg("muted", `${factCount} facts`);
					if (!expanded) return new Text(summary, 0, 0);
					const text = result.content[0];
					return new Text(text?.type === "text" ? text.text : summary, 0, 0);
				}
			}
		},
	});

	// -------------------------------------------------------------------
	// /nuggets command — show facts in an overlay
	// -------------------------------------------------------------------

	pi.registerCommand("nuggets", {
		description: "Show all nuggets facts",
		handler: async (_args, ctx) => {
			const allFacts = factsToList();

			if (!ctx.hasUI) {
				ctx.ui.notify(`${allFacts.length} facts in memory`, "info");
				return;
			}

			await ctx.ui.custom<void>((_tui, theme, _kb, done) => {
				return new NuggetsListComponent(allFacts, theme, () => done());
			});
		},
	});

	// -------------------------------------------------------------------
	// System prompt injection — before each agent turn
	// -------------------------------------------------------------------

	pi.on("before_agent_start", async (event, _ctx) => {
		const allFacts = factsToList();
		if (allFacts.length === 0) return;

		const injection = buildInjection(allFacts);
		if (!injection) return;

		return {
			systemPrompt: event.systemPrompt + injection,
		};
	});

	// -------------------------------------------------------------------
	// Auto-capture from tool results
	// -------------------------------------------------------------------

	pi.on("tool_result", async (event, _ctx) => {
		const filePath = (event.input as any)?.file_path || (event.input as any)?.path;

		if (filePath && typeof filePath === "string") {
			const basename = filePath.split("/").pop() || filePath;

			if (event.toolName === "read") {
				facts.set(`file:${basename}`, filePath);
			} else if (event.toolName === "edit" || event.toolName === "write") {
				facts.set(`edited:${basename}`, filePath);
				shelfRemember("memory", `edited:${basename}`, filePath);
			}
		}

		return;
	});

	// -------------------------------------------------------------------
	// Preference extraction from user input
	// -------------------------------------------------------------------

	pi.on("input", async (event, _ctx) => {
		if (event.source === "extension") {
			return { action: "continue" as const };
		}

		const pref = extractPreference(event.text);
		if (pref) {
			facts.set(pref.key, pref.value);
			shelfRemember("memory", pref.key, pref.value);
		}

		return { action: "continue" as const };
	});

	// -------------------------------------------------------------------
	// Smart compaction — store context before messages are discarded
	// -------------------------------------------------------------------

	pi.on("session_before_compact", async (event, _ctx) => {
		const { messagesToSummarize } = event.preparation;

		const userMessages = messagesToSummarize
			.filter((m: any) => m.role === "user")
			.map((m: any) => {
				if (typeof m.content === "string") return m.content;
				if (Array.isArray(m.content)) {
					return m.content
						.filter((c: any) => c.type === "text")
						.map((c: any) => c.text)
						.join(" ");
				}
				return "";
			})
			.filter(Boolean);

		if (userMessages.length > 0) {
			const taskSummary = userMessages.slice(-3).join(" | ").slice(0, 200);
			facts.set("_task", taskSummary);
			shelfRemember("memory", "_task", taskSummary);
		}

		const toolCalls = messagesToSummarize
			.filter((m: any) => m.role === "assistant")
			.flatMap((m: any) => {
				if (Array.isArray(m.content)) {
					return m.content.filter((c: any) => c.type === "tool_use");
				}
				return [];
			});

		for (const tc of toolCalls.slice(-20)) {
			const fp = tc.input?.file_path || tc.input?.path;
			if (fp && typeof fp === "string") {
				const basename = fp.split("/").pop() || fp;
				const toolName = tc.name || "";
				if (["edit", "write"].includes(toolName)) {
					facts.set(`edited:${basename}`, fp);
				} else if (toolName === "read") {
					facts.set(`file:${basename}`, fp);
				}
			}
		}

		return;
	});

	// -------------------------------------------------------------------
	// Post-compaction + promotion
	// -------------------------------------------------------------------

	pi.on("session_compact", async (_event, _ctx) => {
		// Promote high-recall facts to MEMORY.md
		try {
			promoteFacts(shelf);
		} catch {
			// Non-critical — don't break compaction
		}
	});
}

// ---------------------------------------------------------------------------
// UI component for /nuggets command
// ---------------------------------------------------------------------------

class NuggetsListComponent {
	private facts: Fact[];
	private theme: Theme;
	private onClose: () => void;
	private cachedWidth?: number;
	private cachedLines?: string[];

	constructor(facts: Fact[], theme: Theme, onClose: () => void) {
		this.facts = facts;
		this.theme = theme;
		this.onClose = onClose;
	}

	handleInput(data: string): void {
		if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c")) {
			this.onClose();
		}
	}

	render(width: number): string[] {
		if (this.cachedLines && this.cachedWidth === width) {
			return this.cachedLines;
		}

		const lines: string[] = [];
		const th = this.theme;

		lines.push("");
		const title = th.fg("accent", " Nuggets Memory ");
		const headerLine = th.fg("borderMuted", "\u2500".repeat(3)) + title + th.fg("borderMuted", "\u2500".repeat(Math.max(0, width - 20)));
		lines.push(truncateToWidth(headerLine, width));
		lines.push("");

		if (this.facts.length === 0) {
			lines.push(truncateToWidth(`  ${th.fg("dim", "No facts stored. Ask the agent to remember something!")}`, width));
		} else {
			const prefs = this.facts.filter((f) => f.key.startsWith("pref:"));
			const learns = this.facts.filter((f) => f.key.startsWith("learn"));
			const files = this.facts.filter((f) => f.key.startsWith("file:") || f.key.startsWith("edited:"));
			const other = this.facts.filter(
				(f) =>
					!f.key.startsWith("pref:") &&
					!f.key.startsWith("learn") &&
					!f.key.startsWith("file:") &&
					!f.key.startsWith("edited:") &&
					!f.key.startsWith("_"),
			);

			lines.push(truncateToWidth(`  ${th.fg("muted", `${this.facts.length} facts total`)}`, width));
			lines.push("");

			if (prefs.length) {
				lines.push(truncateToWidth(`  ${th.fg("accent", "Preferences")}`, width));
				for (const f of prefs) {
					lines.push(truncateToWidth(`    ${th.fg("dim", f.key.replace(/^pref:/, ""))}: ${th.fg("text", f.value)}`, width));
				}
				lines.push("");
			}

			if (learns.length) {
				lines.push(truncateToWidth(`  ${th.fg("accent", "Learnings")}`, width));
				for (const f of learns) {
					lines.push(truncateToWidth(`    ${th.fg("dim", f.key.replace(/^learn:?/, ""))}: ${th.fg("text", f.value)}`, width));
				}
				lines.push("");
			}

			if (files.length) {
				lines.push(truncateToWidth(`  ${th.fg("accent", "Files")}`, width));
				for (const f of files.slice(-10)) {
					const icon = f.key.startsWith("edited:") ? th.fg("warning", "\u270e") : th.fg("dim", "\u25cb");
					lines.push(truncateToWidth(`    ${icon} ${th.fg("text", f.value)}`, width));
				}
				lines.push("");
			}

			if (other.length) {
				lines.push(truncateToWidth(`  ${th.fg("accent", "Facts")}`, width));
				for (const f of other) {
					lines.push(truncateToWidth(`    ${th.fg("dim", f.key)}: ${th.fg("text", f.value)}`, width));
				}
				lines.push("");
			}
		}

		lines.push(truncateToWidth(`  ${th.fg("dim", "Press Escape to close")}`, width));
		lines.push("");

		this.cachedWidth = width;
		this.cachedLines = lines;
		return lines;
	}

	invalidate(): void {
		this.cachedWidth = undefined;
		this.cachedLines = undefined;
	}
}
