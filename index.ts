import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

import {
	getAgentDir,
	keyHint,
	type ExtensionAPI,
	type ExtensionCommandContext,
	type ExtensionContext,
	type ReadonlyFooterDataProvider,
	type Theme,
} from "@earendil-works/pi-coding-agent";
import { Key, matchesKey, truncateToWidth, type Component, type TUI, visibleWidth } from "@earendil-works/pi-tui";

interface FooterOrganizerConfig {
	hiddenKeys: string[];
}

interface FooterItem {
	key: string;
	text: string;
	hidden: boolean;
}

const CONFIG_PATH = join(getAgentDir(), "footer-organizer.json");
const MAX_STATUS_ITEMS = 200;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function loadConfig(): FooterOrganizerConfig {
	try {
		const raw = readFileSync(CONFIG_PATH, "utf8");
		const parsed = JSON.parse(raw) as unknown;
		if (!isRecord(parsed) || !Array.isArray(parsed.hiddenKeys)) {
			return { hiddenKeys: [] };
		}
		return {
			hiddenKeys: parsed.hiddenKeys.filter((key): key is string => typeof key === "string" && key.length > 0),
		};
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			return { hiddenKeys: [] };
		}
		console.error("pi-footer-organizer: failed to load config", error);
		return { hiddenKeys: [] };
	}
}

function saveConfig(config: FooterOrganizerConfig): void {
	mkdirSync(dirname(CONFIG_PATH), { recursive: true });
	writeFileSync(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

function sanitizeStatusText(text: string): string {
	return text
		.replace(/[\r\n\t]/g, " ")
		.replace(/ +/g, " ")
		.trim();
}

function formatTokens(count: number): string {
	if (count < 1000) return count.toString();
	if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
	if (count < 1000000) return `${Math.round(count / 1000)}k`;
	if (count < 10000000) return `${(count / 1000000).toFixed(1)}M`;
	return `${Math.round(count / 1000000)}M`;
}

function formatCwdForFooter(cwd: string, home: string | undefined): string {
	if (!home) return cwd;
	const resolvedCwd = resolve(cwd);
	const resolvedHome = resolve(home);
	const relativeToHome = relative(resolvedHome, resolvedCwd);
	const isInsideHome =
		relativeToHome === "" ||
		(relativeToHome !== ".." && !relativeToHome.startsWith(`..${sep}`) && !isAbsolute(relativeToHome));

	if (!isInsideHome) return cwd;
	return relativeToHome === "" ? "~" : `~${sep}${relativeToHome}`;
}

function padVisible(text: string, width: number): string {
	return `${text}${" ".repeat(Math.max(0, width - visibleWidth(text)))}`;
}

function topBorder(title: string, width: number, theme: Theme): string {
	const prefix = `┌─ ${title} `;
	const suffix = "┐";
	const line = `${prefix}${"─".repeat(Math.max(0, width - visibleWidth(prefix) - visibleWidth(suffix)))}${suffix}`;
	return theme.fg("borderMuted", truncateToWidth(line, width, ""));
}

function middleBorder(width: number, theme: Theme): string {
	const line = `├${"─".repeat(Math.max(0, width - 2))}┤`;
	return theme.fg("borderMuted", truncateToWidth(line, width, ""));
}

function bottomBorder(width: number, theme: Theme): string {
	const line = `└${"─".repeat(Math.max(0, width - 2))}┘`;
	return theme.fg("borderMuted", truncateToWidth(line, width, ""));
}

function framedLine(content: string, width: number, theme: Theme): string {
	if (width < 4) return truncateToWidth(content, width, "");
	const innerWidth = width - 2;
	const inner = padVisible(truncateToWidth(content, innerWidth, theme.fg("dim", "…")), innerWidth);
	return `${theme.fg("borderMuted", "│")}${inner}${theme.fg("borderMuted", "│")}`;
}

function collectFooterItems(
	footerData: ReadonlyFooterDataProvider | undefined,
	hiddenKeys: ReadonlySet<string>,
): FooterItem[] {
	const statuses = footerData?.getExtensionStatuses();
	if (!statuses || statuses.size === 0) return [];

	return Array.from(statuses.entries())
		.slice(0, MAX_STATUS_ITEMS)
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([key, text]) => ({
			key,
			text: sanitizeStatusText(text) || "(empty)",
			hidden: hiddenKeys.has(key),
		}));
}

function renderStatsLine(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	footerData: ReadonlyFooterDataProvider,
	theme: Theme,
	width: number,
): string {
	let totalInput = 0;
	let totalOutput = 0;
	let totalCacheRead = 0;
	let totalCacheWrite = 0;
	let totalCost = 0;
	let latestCacheHitRate: number | undefined;

	for (const entry of ctx.sessionManager.getEntries() as Array<Record<string, any>>) {
		if (entry.type !== "message" || entry.message?.role !== "assistant") continue;
		const usage = entry.message.usage;
		if (!usage) continue;

		const input = Number(usage.input ?? 0);
		const output = Number(usage.output ?? 0);
		const cacheRead = Number(usage.cacheRead ?? 0);
		const cacheWrite = Number(usage.cacheWrite ?? 0);

		totalInput += input;
		totalOutput += output;
		totalCacheRead += cacheRead;
		totalCacheWrite += cacheWrite;
		totalCost += Number(usage.cost?.total ?? 0);

		const latestPromptTokens = input + cacheRead + cacheWrite;
		latestCacheHitRate = latestPromptTokens > 0 ? (cacheRead / latestPromptTokens) * 100 : undefined;
	}

	const contextUsage = ctx.getContextUsage();
	const model = ctx.model;
	const contextWindow = contextUsage?.contextWindow ?? model?.contextWindow ?? 0;
	const contextPercentValue = typeof contextUsage?.percent === "number" ? contextUsage.percent : 0;
	const contextPercent = contextUsage?.percent == null ? "?" : contextPercentValue.toFixed(1);
	const contextDisplay = contextPercent === "?" ? `?/${formatTokens(contextWindow)}` : `${contextPercent}%/${formatTokens(contextWindow)}`;

	const statsParts: string[] = [];
	if (totalInput) statsParts.push(theme.fg("dim", `↑${formatTokens(totalInput)}`));
	if (totalOutput) statsParts.push(theme.fg("dim", `↓${formatTokens(totalOutput)}`));
	if (totalCacheRead) statsParts.push(theme.fg("dim", `R${formatTokens(totalCacheRead)}`));
	if (totalCacheWrite) statsParts.push(theme.fg("dim", `W${formatTokens(totalCacheWrite)}`));
	if ((totalCacheRead > 0 || totalCacheWrite > 0) && latestCacheHitRate !== undefined) {
		statsParts.push(theme.fg("dim", `CH${latestCacheHitRate.toFixed(1)}%`));
	}

	const usingSubscription = Boolean(model && (ctx.modelRegistry as any).isUsingOAuth?.(model));
	if (totalCost || usingSubscription) {
		statsParts.push(theme.fg("dim", `$${totalCost.toFixed(3)}${usingSubscription ? " (sub)" : ""}`));
	}

	if (contextPercentValue > 90) {
		statsParts.push(theme.fg("error", contextDisplay));
	} else if (contextPercentValue > 70) {
		statsParts.push(theme.fg("warning", contextDisplay));
	} else {
		statsParts.push(theme.fg("dim", contextDisplay));
	}

	let statsLeft = statsParts.join(theme.fg("dim", " "));
	if (visibleWidth(statsLeft) > width) {
		statsLeft = truncateToWidth(statsLeft, width, theme.fg("dim", "…"));
	}

	const modelName = model?.id ?? "no-model";
	let rightSide = modelName;
	if (model?.reasoning) {
		const thinkingLevel = pi.getThinkingLevel?.() ?? "off";
		rightSide = thinkingLevel === "off" ? `${modelName} • thinking off` : `${modelName} • ${thinkingLevel}`;
	}
	if (footerData.getAvailableProviderCount() > 1 && model) {
		const withProvider = `(${model.provider}) ${rightSide}`;
		if (visibleWidth(statsLeft) + 2 + visibleWidth(withProvider) <= width) {
			rightSide = withProvider;
		}
	}
	rightSide = theme.fg("dim", rightSide);

	const leftWidth = visibleWidth(statsLeft);
	const rightWidth = visibleWidth(rightSide);
	if (leftWidth + 2 + rightWidth <= width) {
		return `${statsLeft}${" ".repeat(Math.max(1, width - leftWidth - rightWidth))}${rightSide}`;
	}

	const availableForRight = width - leftWidth - 2;
	if (availableForRight > 0) {
		const truncatedRight = truncateToWidth(rightSide, availableForRight, "");
		return `${statsLeft}${" ".repeat(Math.max(1, width - leftWidth - visibleWidth(truncatedRight)))}${truncatedRight}`;
	}

	return truncateToWidth(statsLeft, width, theme.fg("dim", "…"));
}

function renderOrganizedFooter(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	footerData: ReadonlyFooterDataProvider,
	hiddenKeys: ReadonlySet<string>,
	theme: Theme,
	width: number,
): string[] {
	let pwd = formatCwdForFooter(ctx.cwd, process.env.HOME || process.env.USERPROFILE);
	const branch = footerData.getGitBranch();
	if (branch) pwd = `${pwd} (${branch})`;

	const sessionName = (ctx.sessionManager as any).getSessionName?.();
	if (typeof sessionName === "string" && sessionName.length > 0) {
		pwd = `${pwd} • ${sessionName}`;
	}

	const lines = [
		truncateToWidth(theme.fg("dim", pwd), width, theme.fg("dim", "…")),
		renderStatsLine(pi, ctx, footerData, theme, width),
	];

	const statusTexts = collectFooterItems(footerData, hiddenKeys)
		.filter((item) => !item.hidden)
		.map((item) => item.text);

	if (statusTexts.length > 0) {
		lines.push(truncateToWidth(statusTexts.join(" "), width, theme.fg("dim", "…")));
	}

	return lines;
}

class FooterToggleList implements Component {
	private selectedIndex = 0;
	private scrollOffset = 0;

	constructor(
		private readonly tui: TUI,
		private readonly theme: Theme,
		private readonly getItems: () => FooterItem[],
		private readonly toggle: (key: string) => void,
		private readonly showAll: () => void,
		private readonly done: () => void,
	) {}

	invalidate(): void {}

	handleInput(data: string): void {
		const items = this.getItems();
		if (this.selectedIndex >= items.length) this.selectedIndex = Math.max(0, items.length - 1);

		if (matchesKey(data, Key.escape) || data === "q") {
			this.done();
			return;
		}

		if (matchesKey(data, Key.up)) {
			this.selectedIndex = Math.max(0, this.selectedIndex - 1);
			this.tui.requestRender();
			return;
		}

		if (matchesKey(data, Key.down)) {
			this.selectedIndex = Math.min(Math.max(0, items.length - 1), this.selectedIndex + 1);
			this.tui.requestRender();
			return;
		}

		if (matchesKey(data, Key.enter)) {
			const item = items[this.selectedIndex];
			if (item) {
				this.toggle(item.key);
				this.tui.requestRender();
			}
			return;
		}

		if (data === "r") {
			this.showAll();
			this.tui.requestRender();
		}
	}

	render(width: number): string[] {
		const items = this.getItems();
		if (this.selectedIndex >= items.length) this.selectedIndex = Math.max(0, items.length - 1);

		const maxRows = Math.max(1, Math.min(12, (this.tui.terminal?.rows ?? 24) - 8, Math.max(1, items.length)));
		if (this.selectedIndex < this.scrollOffset) this.scrollOffset = this.selectedIndex;
		if (this.selectedIndex >= this.scrollOffset + maxRows) {
			this.scrollOffset = this.selectedIndex - maxRows + 1;
		}
		this.scrollOffset = Math.max(0, Math.min(this.scrollOffset, Math.max(0, items.length - maxRows)));

		const lines: string[] = [topBorder("Footer display", width, this.theme)];
		lines.push(
			framedLine(
				` ${keyHint("tui.editor.cursorUp", "移動")}  ${keyHint("tui.select.confirm", "オン/オフ")}  r 全表示  ${keyHint("tui.select.cancel", "閉じる")}`,
				width,
				this.theme,
			),
		);
		lines.push(middleBorder(width, this.theme));

		if (items.length === 0) {
			lines.push(framedLine(` ${this.theme.fg("muted", "現在フッターに出ている拡張表示はありません。")}`, width, this.theme));
			lines.push(bottomBorder(width, this.theme));
			return lines;
		}

		const visibleItems = items.slice(this.scrollOffset, this.scrollOffset + maxRows);
		const keyWidth = Math.min(
			28,
			Math.max(12, ...visibleItems.map((item) => Math.min(28, visibleWidth(item.key)))),
		);

		for (const [offset, item] of visibleItems.entries()) {
			const index = this.scrollOffset + offset;
			const selected = index === this.selectedIndex;
			const cursor = selected ? this.theme.fg("accent", "›") : " ";
			const state = item.hidden ? this.theme.fg("dim", "○ off") : this.theme.fg("success", "● on ");
			const plainKey = truncateToWidth(item.key, keyWidth, "…");
			const styledKey = selected
				? this.theme.fg("accent", plainKey)
				: item.hidden
					? this.theme.fg("dim", plainKey)
					: this.theme.fg("text", plainKey);
			const key = padVisible(styledKey, keyWidth);
			const text = item.hidden ? this.theme.fg("dim", item.text) : item.text;
			lines.push(framedLine(` ${cursor} ${state}  ${key}  ${text}`, width, this.theme));
		}

		if (items.length > maxRows) {
			const first = this.scrollOffset + 1;
			const last = this.scrollOffset + visibleItems.length;
			lines.push(framedLine(` ${this.theme.fg("dim", `${first}-${last}/${items.length}`)}`, width, this.theme));
		}

		lines.push(bottomBorder(width, this.theme));
		return lines;
	}
}

function formatItemsForText(items: FooterItem[]): string {
	if (items.length === 0) return "現在フッターに出ている拡張表示はありません。";
	return items
		.map((item) => `${item.hidden ? "off" : "on "}  ${item.key}  ${item.text}`)
		.join("\n");
}

export default function piFooterOrganizer(pi: ExtensionAPI) {
	let config = loadConfig();
	let footerDataRef: ReadonlyFooterDataProvider | undefined;
	let latestCtx: ExtensionContext | undefined;
	let footerTui: TUI | undefined;

	const hiddenKeys = () => new Set(config.hiddenKeys);
	const getItems = () => collectFooterItems(footerDataRef, hiddenKeys());

	function persist(nextHiddenKeys: Set<string>): void {
		config = { hiddenKeys: Array.from(nextHiddenKeys).sort((a, b) => a.localeCompare(b)) };
		saveConfig(config);
		footerTui?.requestRender();
	}

	function toggleKey(key: string): void {
		const next = hiddenKeys();
		if (next.has(key)) next.delete(key);
		else next.add(key);
		persist(next);
	}

	function showAll(): void {
		persist(new Set());
	}

	function installFooter(ctx: ExtensionContext): void {
		latestCtx = ctx;
		if (ctx.mode !== "tui") return;

		ctx.ui.setFooter((tui, theme, footerData) => {
			footerDataRef = footerData;
			footerTui = tui;
			const unsubscribe = footerData.onBranchChange(() => tui.requestRender());

			return {
				dispose: unsubscribe,
				invalidate() {},
				render(width: number): string[] {
					const currentCtx = latestCtx ?? ctx;
					return renderOrganizedFooter(pi, currentCtx, footerData, hiddenKeys(), theme, width);
				},
			};
		});
	}

	pi.on("session_start", async (_event, ctx) => {
		config = loadConfig();
		installFooter(ctx);
	});

	pi.on("model_select", async (_event, ctx) => {
		latestCtx = ctx;
		footerTui?.requestRender();
	});

	pi.on("thinking_level_select", async (_event, ctx) => {
		latestCtx = ctx;
		footerTui?.requestRender();
	});

	pi.on("turn_end", async (_event, ctx) => {
		latestCtx = ctx;
		footerTui?.requestRender();
	});

	pi.on("session_info_changed", async (_event, ctx) => {
		latestCtx = ctx;
		footerTui?.requestRender();
	});

	pi.on("session_shutdown", async (_event, ctx) => {
		if (ctx.mode === "tui") ctx.ui.setFooter(undefined);
		footerDataRef = undefined;
		footerTui = undefined;
		latestCtx = undefined;
	});

	pi.registerCommand("footer", {
		description: "拡張機能が追加したフッター表示をオン/オフします",
		handler: async (args: string | undefined, ctx: ExtensionCommandContext) => {
			latestCtx = ctx;
			const trimmed = args?.trim() ?? "";
			if (trimmed === "reset") {
				showAll();
				ctx.ui.notify("Footer display: all extension statuses are visible", "info");
				return;
			}

			if (ctx.mode !== "tui") {
				pi.sendMessage({
					customType: "footer-organizer",
					content: formatItemsForText(getItems()),
					display: true,
				});
				return;
			}

			await ctx.ui.custom<void>((tui, theme, _keybindings, done): Component => {
				const container = new FooterToggleList(
					tui,
					theme,
					getItems,
					toggleKey,
					showAll,
					() => done(undefined),
				);

				return {
					render: (width: number) => container.render(width),
					invalidate: () => container.invalidate(),
					handleInput: (data: string) => container.handleInput(data),
				};
			});
		},
	});
}
