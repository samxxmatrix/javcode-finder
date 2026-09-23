import { parseSearchPageHtml } from "../src/lib/javtrailers";
import {
	buildTranslateUrl,
	parseTranslateResponse,
	type TranslateTarget,
} from "../src/lib/translate";

export default defineBackground(() => {
	// 给 media.javtrailers.com 响应注入 CORS 头，使扩展面板内的 hls.js 能跨域拉取 HLS 预告片流。
	// 仅 Chromium 的 declarativeNetRequest 支持修改响应头；Firefox 上跳过（播放侧走失败降级）。
	const setupTrailerCors = () => {
		const dnr = (
			globalThis as typeof globalThis & {
				chrome?: {
					declarativeNetRequest?: {
						updateDynamicRules?: (options: {
							removeRuleIds: number[];
							addRules: Array<{
								id: number;
								priority: number;
								action: {
									type: "modifyHeaders";
									responseHeaders: Array<{
										header: string;
										operation: "set";
										value: string;
									}>;
								};
								condition: {
									urlFilter: string;
									resourceTypes: string[];
								};
							}>;
						}) => Promise<void>;
					};
				};
			}
		).chrome?.declarativeNetRequest;

		if (!dnr?.updateDynamicRules) return;

		dnr.updateDynamicRules({
			removeRuleIds: [9001],
			addRules: [
				{
					id: 9001,
					priority: 1,
					action: {
						type: "modifyHeaders",
						responseHeaders: [
							{
								header: "Access-Control-Allow-Origin",
								operation: "set",
								value: "*",
							},
						],
					},
					condition: {
						urlFilter: "||media.javtrailers.com",
						resourceTypes: ["xmlhttprequest", "media", "other"],
					},
				},
			],
		}).catch((error: unknown) => {
			console.warn("Failed to register trailer CORS rule:", error);
		});
	};

	setupTrailerCors();

	// 解析 javtrailers 搜索页第一张卡片，返回确认匹配的详情页 URL 与 Content ID。
	// 面板页面直接 fetch 该站会被 CORS 拦截，而 background 持有 host_permissions 不受限。
	// 用原生回调模式（sendResponse + return true），避免 polyfill Promise 响应在部分环境不生效。
	if (typeof browser !== "undefined" && browser.runtime?.onMessage) {
		browser.runtime.onMessage.addListener(
			(
				message: unknown,
				_sender: unknown,
				sendResponse: (response: unknown) => void,
			): boolean | undefined => {
				const msg = message as {
					type?: string;
					code?: string;
					text?: string;
					target?: TranslateTarget;
				};

				// 标题翻译：谷歌翻译公开端点，失败返回空译文（调用方回退原文）
				if (msg?.type === "jt:translate" && msg.text) {
					const target = msg.target === "zh-TW" ? "zh-TW" : "zh-CN";
					void (async () => {
						try {
							const res = await fetch(
								buildTranslateUrl(msg.text!, target),
								{ signal: AbortSignal.timeout(5000) },
							);
							if (!res.ok) {
								sendResponse({ translated: "" });
								return;
							}
							const data = await res.json();
							sendResponse({
								translated: parseTranslateResponse(data),
							});
						} catch {
							sendResponse({ translated: "" });
						}
					})();
					return true;
				}

				if (msg?.type !== "jt:resolve-detail" || !msg.code) return undefined;
				const code = msg.code;

				void (async () => {
					try {
						const res = await fetch(
							`https://javtrailers.com/search/${encodeURIComponent(code)}`,
							{ signal: AbortSignal.timeout(5000) },
						);
						if (!res.ok) {
							sendResponse({
								detailUrl: null,
								contentId: null,
								title: null,
								debug: `HTTP ${res.status}`,
							});
							return;
						}
						const html = await res.text();
						const resolution = parseSearchPageHtml(html, code);
						sendResponse({
							detailUrl: resolution?.detailUrl ?? null,
							contentId: resolution?.contentId ?? null,
							title: resolution?.title ?? null,
							debug: resolution
								? undefined
								: `no-match(len=${html.length})`,
						});
					} catch (error) {
						sendResponse({
							detailUrl: null,
							contentId: null,
							title: null,
							debug: `fetch-error:${error instanceof Error ? error.message : String(error)}`,
						});
					}
				})();

				return true; // 保持消息通道直到 sendResponse 被调用
			},
		);
	}

	// Enable opening the side panel on extension action click in supported Chromium browsers
	const chromium = globalThis as typeof globalThis & {
		chrome?: {
			sidePanel?: {
				setPanelBehavior?: (options: {
					openPanelOnActionClick: boolean;
				}) => Promise<void>;
				setOptions?: (options: {
					tabId?: number;
					path?: string;
					enabled?: boolean;
				}) => Promise<void>;
				getOptions?: (options: {
					tabId?: number;
				}) => Promise<{
					enabled?: boolean;
					path?: string;
				}>;
				open?: (options: {
					tabId?: number;
					windowId?: number;
				}) => Promise<void>;
				close?: (options: {
					tabId?: number;
					windowId?: number;
				}) => Promise<void>;
			};
		};
	};
	const sidePanel = chromium.chrome?.sidePanel;

	// Disable opening globally on action click & disable side panel by default for all tabs
	const setupDefaults = () => {
		if (sidePanel?.setPanelBehavior) {
			sidePanel
				.setPanelBehavior({ openPanelOnActionClick: false })
				.catch((error: unknown) => {
					console.warn("Failed to set openPanelOnActionClick:", error);
				});
		}

		if (sidePanel?.setOptions) {
			sidePanel
				.setOptions({ enabled: false })
				.catch((error: unknown) => {
					console.warn("Failed to set default sidePanel options:", error);
				});
		}
	};

	setupDefaults();
	if (typeof browser !== "undefined" && browser.runtime?.onInstalled) {
		browser.runtime.onInstalled.addListener(setupDefaults);
	}

	// Track tabs where the side panel is currently open
	const openTabs = new Set<number>();

	// Maintain connection ports with side panels to accurately track open/close lifecycle
	if (typeof browser !== "undefined" && browser.runtime?.onConnect) {
		browser.runtime.onConnect.addListener((port) => {
			if (port.name.startsWith("sidepanel:")) {
				const rawId = port.name.split(":")[1];
				const tabId = rawId ? parseInt(rawId, 10) : NaN;
				if (!isNaN(tabId)) {
					openTabs.add(tabId);
					port.onDisconnect.addListener(() => {
						openTabs.delete(tabId);
						// Ensure this tab does not retain enabled state once closed
						if (sidePanel?.setOptions) {
							sidePanel
								.setOptions({ tabId, enabled: false })
								.catch(() => {});
						}
					});
				}
			}
		});
	}

	// Clean up tab tracking when tabs are closed
	if (typeof browser !== "undefined" && browser.tabs?.onRemoved) {
		browser.tabs.onRemoved.addListener((closedTabId) => {
			openTabs.delete(closedTabId);
		});
	}

	// Toggle side panel on toolbar action click for the active tab
	if (typeof browser !== "undefined" && browser.action?.onClicked) {
		browser.action.onClicked.addListener((tab) => {
			if (!tab.id) return;
			const tabId = tab.id;

			if (sidePanel) {
				if (openTabs.has(tabId)) {
					// Currently open: close the panel on this tab
					openTabs.delete(tabId);
					if (sidePanel.close) {
						sidePanel.close({ tabId }).catch(() => {
							sidePanel.setOptions?.({ tabId, enabled: false }).catch(() => {});
						});
					} else if (sidePanel.setOptions) {
						sidePanel
							.setOptions({ tabId, enabled: false })
							.catch((err: unknown) => {
								console.warn("Failed to close side panel for tab:", tabId, err);
							});
					}
				} else {
					// Currently closed: enable and open synchronously within user gesture context
					if (sidePanel.setOptions && sidePanel.open) {
						openTabs.add(tabId);
						sidePanel
							.setOptions({
								tabId,
								path: `sidepanel.html?tabId=${tabId}`,
								enabled: true,
							})
							.catch((err: unknown) => {
								console.warn(
									"Failed to set side panel options for tab:",
									tabId,
									err,
								);
							});

						sidePanel.open({ tabId }).catch((err: unknown) => {
							console.warn("Failed to open side panel for tab:", tabId, err);
							openTabs.delete(tabId);
						});
					}
				}
			} else {
				// Non-chromium fallback (e.g. Firefox sidebarAction)
				const ff = browser as typeof browser & {
					sidebarAction?: {
						toggle?: () => Promise<void>;
						open?: () => Promise<void>;
					};
				};
				if (ff.sidebarAction?.toggle) {
					ff.sidebarAction.toggle().catch(() => {});
				} else if (ff.sidebarAction?.open) {
					ff.sidebarAction.open().catch(() => {});
				}
			}
		});
	}
});
