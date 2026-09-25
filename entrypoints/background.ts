import { parseDetailPageFallback, parseSearchPageHtml } from "../src/lib/javtrailers";
import {
	buildBasicAuth,
	joinWebdavUrl,
} from "../src/lib/favorites";
import {
	buildGoogleUrl,
	buildWorkerTranslateBody,
	buildWorkerUrl,
	formatWorkerError,
	formatWorkerFetchError,
	parseGoogleResponse,
	parseWorkerHealth,
	parseWorkerTranslation,
	parseWorkerUsage,
	type TranslateTarget,
} from "../src/lib/translate";
import { clearCodeMarksForTab } from "../src/lib/mark-codes";

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

	// 从消息中提取 WebDAV 配置；地址或用户名为空返回 null（未配置云端）
	const getWebdav = (msg: {
		webdavUrl?: string;
		webdavUser?: string;
		webdavPass?: string;
	}): { url: string; auth: string } | null => {
		const url = (msg.webdavUrl || "").trim();
		const user = (msg.webdavUser || "").trim();
		if (!url || !user) return null;
		const pass = typeof msg.webdavPass === "string" ? msg.webdavPass : "";
		return { url, auth: buildBasicAuth(user, pass) };
	};

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
					deeplKey?: string;
					translateUrl?: string;
					translateEnabled?: boolean;
					webdavUrl?: string;
					webdavUser?: string;
					webdavPass?: string;
					body?: string;
					contentId?: string;
				};

				// 标题翻译：优先自建 Worker（开关开启且地址/Key 齐全）；
				// 失败或未配置时无感降级谷歌 gtx。Worker 失败原因（错误码+文案）随响应
				// 返回给面板显示在错误行，不影响谷歌兜底出的译文。全程静默不输出控制台。
				if (msg?.type === "jt:translate" && msg.text) {
					const target = msg.target === "zh-TW" ? "zh-TW" : "zh-CN";
					const key = (msg.deeplKey || "").trim();
					const baseUrl = (msg.translateUrl || "").trim();
					void (async () => {
						// 一级：自建 Worker（仅开关开启且地址与 Key 齐全时尝试）
						let workerError: string | undefined;
						if (msg.translateEnabled && baseUrl && key) {
							try {
								const res = await fetch(buildWorkerUrl(baseUrl, "translate"), {
									method: "POST",
									headers: {
										Authorization: `Bearer ${key}`,
										"Content-Type": "application/json",
									},
									body: buildWorkerTranslateBody(msg.text!, target),
									signal: AbortSignal.timeout(5000),
								});
								if (res.ok) {
									const data = await res.json();
									const translated = parseWorkerTranslation(data);
									if (translated) {
										sendResponse({ translated });
										return;
									}
									// success: false 或空译文 → 记录原因并降级谷歌
									workerError = formatWorkerError(res.status, data);
								} else {
									// 非 2xx → 记录原因并降级谷歌
									let data: unknown = null;
									try {
										data = await res.json();
									} catch {
										// 响应体不是 JSON 时仅用状态码
									}
									workerError = formatWorkerError(res.status, data);
								}
							} catch (error) {
								// 网络异常/超时 → 记录原因并降级谷歌
								workerError = formatWorkerFetchError(error);
							}
						}
						// 二级：谷歌 gtx 公开端点（限流 429 时同样失败，回退原文）
						try {
							const res = await fetch(buildGoogleUrl(msg.text!, target), {
								signal: AbortSignal.timeout(5000),
							});
							if (!res.ok) {
								sendResponse({
									translated: "",
									// 403/429 = 谷歌限流：界面提示人工验证（打开验证页后重试）
									error:
										res.status === 403 || res.status === 429
											? "google-verify"
											: `谷歌翻译错误：HTTP ${res.status}`,
									workerError,
								});
								return;
							}
							const data = await res.json();
							sendResponse({
								translated: parseGoogleResponse(data),
								workerError,
							});
						} catch (error) {
							sendResponse({
								translated: "",
								error: `谷歌翻译错误：${
									error instanceof Error ? error.message : String(error)
								}`,
								workerError,
							});
						}
					})();
					return true;
				}

				// Worker 健康检查：开关打开时的接口可用性验证
				if (msg?.type === "jt:health") {
					const key = (msg.deeplKey || "").trim();
					const baseUrl = (msg.translateUrl || "").trim();
					void (async () => {
						if (!baseUrl || !key) {
							sendResponse({ ok: false, error: "翻译 API 地址和 Key 均需填写" });
							return;
						}
						try {
							const res = await fetch(buildWorkerUrl(baseUrl, "health"), {
								headers: { Authorization: `Bearer ${key}` },
								signal: AbortSignal.timeout(5000),
							});
							if (!res.ok) {
								sendResponse({ ok: false, error: `HTTP ${res.status}` });
								return;
							}
							const data = await res.json();
							const healthy = parseWorkerHealth(data);
							sendResponse({
								ok: healthy,
								error: healthy ? undefined : "接口响应异常",
							});
						} catch (error) {
							sendResponse({
								ok: false,
								error: `网络错误：${
									error instanceof Error ? error.message : String(error)
								}`,
							});
						}
					})();
					return true;
				}

				// Worker 用量：数据与基数均由接口返回；失败返回 null（界面显示 --/--万）
				if (msg?.type === "jt:usage") {
					const key = (msg.deeplKey || "").trim();
					const baseUrl = (msg.translateUrl || "").trim();
					void (async () => {
						if (!baseUrl || !key) {
							sendResponse({ count: null, limit: null });
							return;
						}
						try {
							const res = await fetch(buildWorkerUrl(baseUrl, "usage"), {
								headers: { Authorization: `Bearer ${key}` },
								signal: AbortSignal.timeout(5000),
							});
							if (!res.ok) {
								sendResponse({ count: null, limit: null });
								return;
							}
							const data = await res.json();
							const usage = parseWorkerUsage(data);
							sendResponse(
								usage
									? { count: usage.count, limit: usage.limit }
									: { count: null, limit: null },
							);
						} catch {
							sendResponse({ count: null, limit: null });
						}
					})();
					return true;
				}

				// WebDAV 云端：验证连接（PROPFIND Depth:0，只查目录本身，1 次请求）。
				// status 0 = 网络错误；其余状态由界面按 207/401/404/403/429 分类。
				if (msg?.type === "jt:webdav-verify") {
					const wd = getWebdav(msg);
					void (async () => {
						if (!wd) {
							sendResponse({ ok: false, status: 0 });
							return;
						}
						try {
							const res = await fetch(wd.url, {
								method: "PROPFIND",
								headers: {
									Authorization: wd.auth,
									Depth: "0",
								},
								signal: AbortSignal.timeout(5000),
							});
							sendResponse({ ok: res.status === 207, status: res.status });
						} catch {
							sendResponse({ ok: false, status: 0 });
						}
					})();
					return true;
				}

				// WebDAV 云端：拉取收藏文件。404 = 云端无数据。
				if (msg?.type === "jt:webdav-get") {
					const wd = getWebdav(msg);
					void (async () => {
						if (!wd) {
							sendResponse({ found: false });
							return;
						}
						try {
							const res = await fetch(joinWebdavUrl(wd.url), {
								method: "GET",
								headers: { Authorization: wd.auth },
								signal: AbortSignal.timeout(5000),
							});
							if (res.status === 404) {
								sendResponse({ found: false });
								return;
							}
							if (!res.ok) {
								sendResponse({ found: false, error: `HTTP ${res.status}` });
								return;
							}
							const data = await res.json();
							sendResponse({ found: true, data });
						} catch (error) {
							sendResponse({
								found: false,
								error:
									error instanceof Error ? error.message : String(error),
							});
						}
					})();
					return true;
				}

				// WebDAV 云端：整体覆盖收藏文件。失败返回 ok: false，界面静默处理。
				if (msg?.type === "jt:webdav-put") {
					const wd = getWebdav(msg);
					void (async () => {
						if (!wd) {
							sendResponse({ ok: false, status: 0 });
							return;
						}
						try {
							const res = await fetch(joinWebdavUrl(wd.url), {
								method: "PUT",
								headers: {
									Authorization: wd.auth,
									"Content-Type": "application/json",
								},
								body: typeof msg.body === "string" ? msg.body : "",
								signal: AbortSignal.timeout(5000),
							});
							sendResponse({ ok: res.ok, status: res.status });
						} catch {
							sendResponse({ ok: false, status: 0 });
						}
					})();
					return true;
				}

				// 详情页兜底：主媒体服务 404 时，从详情页提取 mgstage 封面与 sample MP4
				if (msg?.type === "jt:resolve-fallback") {
					const contentId = (msg.contentId || "").trim();
					void (async () => {
						if (!contentId) {
							sendResponse({ coverUrl: null, trailerUrl: null });
							return;
						}
						try {
							const res = await fetch(
								`https://javtrailers.com/video/${encodeURIComponent(contentId)}`,
								{ signal: AbortSignal.timeout(5000) },
							);
							if (!res.ok) {
								sendResponse({ coverUrl: null, trailerUrl: null });
								return;
							}
							const html = await res.text();
							sendResponse(parseDetailPageFallback(html));
						} catch {
							sendResponse({ coverUrl: null, trailerUrl: null });
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
						// 面板关闭后页面上的番号圆点标记随之清理
						void clearCodeMarksForTab(tabId);
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
