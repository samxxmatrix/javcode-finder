import {
	buildCoverUrlFromContentId,
	buildTrailerUrlFromContentId,
	parseDetailPageFallback,
	parseSearchPageHtml,
} from "../src/lib/javtrailers";
import {
	buildDmmHealthUrl,
	buildDmmLookupUrl,
	buildFalenoLookupUrl,
	formatDmmError,
	parseDmmLookupError,
	readDmmLookupResponse,
	type DmmLookupData,
} from "../src/lib/dmm";
import { resolvePreview } from "../src/lib/resolve-preview";
import {
	buildFalenoWorksUrl,
	matchesFalenoPrefix,
	parseFalenoWorksHtml,
	toFalenoCodeKey,
} from "../src/lib/faleno";
import type { PreviewLookupError, PreviewMedia } from "../src/lib/types";
import {
	buildBasicAuth,
	joinWebdavUrl,
} from "../src/lib/favorites";
import {
	buildBingBody,
	buildBingUrl,
	buildGoogleBody,
	buildGooglePostUrl,
	buildWorkerTranslateBody,
	buildWorkerUrl,
	formatBingError,
	formatBingFetchError,
	formatGoogleError,
	formatGoogleFetchError,
	formatWorkerError,
	formatWorkerFetchError,
	parseBingResponse,
	parseGoogleResponse,
	parseWorkerHealth,
	parseWorkerTranslation,
	parseWorkerUsage,
	type FallbackService,
	type TranslateTarget,
} from "../src/lib/translate";
import { clearCodeMarksForTab } from "../src/lib/mark-codes";
import { withRetry } from "../src/lib/retry";
import { messages } from "../src/lib/locales";
import type { SupportedLocale } from "../src/lib/types";

// 反代查询（CF 入口 → 东京 Vercel）超时策略：
// 首次 8 s 覆盖冷启动（实测 4.4 s）；失败后的第二次只给 5 s —— 此时实例已被首次请求唤醒，
// 正常耗时 0.7-1.8 s，不需要再等满 8 s。最坏 13 s 后降级到下一级数据源。
const PROXY_LOOKUP_FIRST_TIMEOUT_MS = 8000;
const PROXY_LOOKUP_RETRY_TIMEOUT_MS = 5000;
const PROXY_LOOKUP_ATTEMPTS = 2;

/** 反代查询统一入口：首次 8 s，失败后重试一次（5 s） */
const fetchProxyWithRetry = (url: string): Promise<Response> =>
	withRetry(
		(attempt) =>
			fetch(url, {
				signal: AbortSignal.timeout(
					attempt === 1
						? PROXY_LOOKUP_FIRST_TIMEOUT_MS
						: PROXY_LOOKUP_RETRY_TIMEOUT_MS,
				),
			}),
		{ attempts: PROXY_LOOKUP_ATTEMPTS },
	);

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
					fallbackService?: FallbackService;
					locale?: SupportedLocale;
					webdavUrl?: string;
					webdavUser?: string;
					webdavPass?: string;
					body?: string;
					contentId?: string;
					dmmApiUrl?: string;
					dmmApiKey?: string;
					dmmEnabled?: boolean;
					falenoPrefixes?: string[];
				};

				// 标题翻译：优先自建 Worker（开关开启且地址/Key 齐全）；
				// 失败或未配置时降级用户选定的备用服务（谷歌 t 端点或微软 Edge 内置接口）。
				// Worker 失败原因（错误码+文案）随响应返回给面板显示在错误行，
				// 不影响备用服务出的译文。全程静默不输出控制台。
				if (msg?.type === "jt:translate" && msg.text) {
					const target = msg.target === "zh-TW" ? "zh-TW" : "zh-CN";
					const fallback: FallbackService =
						msg.fallbackService === "bing" ? "bing" : "google";
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
									workerError = formatWorkerError(res.status, data, target);
								} else {
									// 非 2xx → 记录原因并降级谷歌
									let data: unknown = null;
									try {
										data = await res.json();
									} catch {
										// 响应体不是 JSON 时仅用状态码
									}
									workerError = formatWorkerError(res.status, data, target);
								}
							} catch (error) {
								// 网络异常/超时 → 记录原因并降级谷歌
								workerError = formatWorkerFetchError(error, target);
							}
						}
						// 二级：微软 Edge 内置翻译接口（无认证；参数校验严格，语言码走 BCP-47 映射）
						if (fallback === "bing") {
							try {
								const res = await fetch(buildBingUrl(target), {
									method: "POST",
									headers: { "Content-Type": "application/json" },
									body: buildBingBody(msg.text!),
									signal: AbortSignal.timeout(5000),
								});
								if (!res.ok) {
									sendResponse({
										translated: "",
										error: formatBingError(res.status, target),
										workerError,
									});
									return;
								}
								const data = await res.json();
								sendResponse({
									translated: parseBingResponse(data),
									workerError,
								});
							} catch (error) {
								sendResponse({
									translated: "",
									error: formatBingFetchError(error, target),
									workerError,
								});
							}
							return;
						}
						// 二级：谷歌 gtx t 端点（POST 表单；single 端点已被风控封禁，不再使用）
						try {
							const res = await fetch(buildGooglePostUrl(target), {
								method: "POST",
								body: buildGoogleBody(msg.text!),
								signal: AbortSignal.timeout(5000),
							});
							if (!res.ok) {
								sendResponse({
									translated: "",
									// 403/429 = 谷歌限流：界面提示人工验证（打开验证页后重试）
									error:
										res.status === 403 || res.status === 429
											? "google-verify"
											: formatGoogleError(res.status, target),
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
								error: formatGoogleFetchError(error, target),
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
					// 健康检查在设置页发起，界面语言可为英文：文案走三语言 messages
					const m = messages[msg.locale ?? "zh-hans"];
					void (async () => {
						if (!baseUrl || !key) {
							sendResponse({ ok: false, error: m.translateApiIncomplete });
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
								error: healthy ? undefined : m.abnormalResponse,
							});
						} catch {
							// 网络层失败不展示浏览器英文消息（如 Failed to fetch）
							sendResponse({ ok: false, error: m.networkError });
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

				// DMM 健康检查：开关打开时的接口可用性验证（cid-only 接口，最轻量）
				if (msg?.type === "jt:dmm-health") {
					const key = (msg.dmmApiKey || "").trim();
					const baseUrl = (msg.dmmApiUrl || "").trim();
					const m = messages[msg.locale ?? "zh-hans"];
					void (async () => {
						if (!baseUrl || !key) {
							sendResponse({
								ok: false,
								error: m.dmmIncomplete,
							});
							return;
						}
						try {
							// BDSM-091 实测稳定存在，作为连通性探针。
							// 与查询同一条反代路径，同样用 8 s + 一次重试：
							// 冷启动超时会把开关弹回关闭，等于让 DMM 静默失效。
							const res = await fetchProxyWithRetry(
								buildDmmHealthUrl(baseUrl, key, "BDSM-091"),
							);
							if (!res.ok) {
								let data: unknown = null;
								try {
									data = await res.json();
								} catch {
									// 响应体不是 JSON 时仅用状态码
								}
								sendResponse({
									ok: false,
									error: formatDmmError(res.status, data, msg.locale),
								});
								return;
							}
							sendResponse({ ok: true });
						} catch {
							// 网络层失败不展示浏览器英文消息（如 Failed to fetch）
							sendResponse({
								ok: false,
								error: `${m.dmmError}：${m.networkError}`,
							});
						}
					})();
					return true;
				}

				// DMM 查询（内部共用）：返回结构化错误以便预览保留接口详情。
				const lookupDmm = async (
					baseUrl: string,
					key: string,
					code: string,
				): Promise<DmmLookupData | null> => {
					let res: Response;
					try {
						res = await fetchProxyWithRetry(buildDmmLookupUrl(baseUrl, key, code));
					} catch (error) {
						const kind =
							error instanceof Error && error.name === "TimeoutError"
								? "timeout"
								: "network";
						throw {
							source: "dmm",
							kind,
							status: 0,
						} satisfies PreviewLookupError;
					}

					if (!res.ok) {
						let data: unknown = null;
						try {
							data = await res.json();
						} catch {
							// Keep HTTP status even when the response body is malformed.
						}
						throw {
							source: "dmm",
							...parseDmmLookupError(res.status, data),
						} satisfies PreviewLookupError;
					}
					return readDmmLookupResponse(res);
				};

				// FALENO 反代查询：与 lookupDmm 同一入口（东京出口 + 永久缓存）。
				// 错误统一改标为 faleno 来源，错误行才显示 FALENO 而不是 DMM。
				const lookupFalenoViaProxy = async (
					baseUrl: string,
					apiKey: string,
					falenoCode: string,
				): Promise<DmmLookupData | null> => {
					let res: Response;
					try {
						res = await fetchProxyWithRetry(
							buildFalenoLookupUrl(baseUrl, apiKey, falenoCode),
						);
					} catch (error) {
						throw {
							source: "faleno",
							kind:
								error instanceof Error && error.name === "TimeoutError"
									? "timeout"
									: "network",
							status: 0,
						} satisfies PreviewLookupError;
					}

					// 上游 404 与 40401 都按查无处理（与直连分支语义一致）
					if (res.status === 404) return null;
					if (!res.ok) {
						let data: unknown = null;
						try {
							data = await res.json();
						} catch {
							// 响应体不是 JSON 时仅用状态码
						}
						const parsed = parseDmmLookupError(res.status, data);
						if (parsed.kind === "not_found") return null;
						throw { source: "faleno", ...parsed } satisfies PreviewLookupError;
					}

					try {
						return await readDmmLookupResponse(res);
					} catch (error) {
						// readDmmLookupResponse 抛的是 dmm 来源的结构化错误，这里换标签
						throw {
							...(error as PreviewLookupError),
							source: "faleno",
						} satisfies PreviewLookupError;
					}
				};

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
				const falenoPrefixes = Array.isArray(msg.falenoPrefixes)
					? msg.falenoPrefixes
					: [];

				void (async () => {
					const dmmBase = (msg.dmmApiUrl || "").trim();
					const dmmKey = (msg.dmmApiKey || "").trim();
					const resolution = await resolvePreview({
						dmmEnabled:
							msg.dmmEnabled === true && Boolean(dmmBase && dmmKey),
						dmmLookup: async () => {
							const dmm = await lookupDmm(dmmBase, dmmKey, code);
							if (!dmm) return null;
							return {
								source: "dmm",
								detailUrl: dmm.detailUrl,
								contentId: dmm.cid,
								title: dmm.title,
								shortTitle: dmm.shortTitle,
								coverUrl: dmm.coverUrl,
								previewUrl: dmm.previewUrl,
								previewType: "mp4",
							} satisfies PreviewMedia;
						},
						javtrailersLookup: async () => {
							let res: Response;
							try {
								res = await fetch(
									`https://javtrailers.com/search/${encodeURIComponent(code)}`,
									{ signal: AbortSignal.timeout(5000) },
								);
							} catch (error) {
								throw {
									source: "javtrailers",
									kind:
										error instanceof Error &&
										error.name === "TimeoutError"
											? "timeout"
											: "network",
								} satisfies PreviewLookupError;
							}
							if (!res.ok) {
								throw {
									source: "javtrailers",
									kind: "http",
									status: res.status,
								} satisfies PreviewLookupError;
							}
							const html = await res.text();
							const match = parseSearchPageHtml(html, code);
							if (!match) return null;
							return {
								source: "javtrailers",
								detailUrl: match.detailUrl,
								contentId: match.contentId,
								title: match.title,
								shortTitle: null,
								coverUrl: buildCoverUrlFromContentId(match.contentId),
								previewUrl: buildTrailerUrlFromContentId(match.contentId),
								previewType: "hls",
							} satisfies PreviewMedia;
						},
						falenoLookup: async () => {
							// 前缀不匹配则不触发兜底(返回 null = 跳过)
							if (!matchesFalenoPrefix(code, falenoPrefixes)) {
								return null;
							}
							// DMM API 已启用（开关 + 地址 + Key）→ 复用同一反代：
							// 东京出口不受地域拦截，且有永久缓存，用户侧不再直连 faleno.jp
							if (msg.dmmEnabled === true && dmmBase && dmmKey) {
								const proxied = await lookupFalenoViaProxy(
									dmmBase,
									dmmKey,
									code,
								);
								if (!proxied) return null;
								return {
									source: "faleno",
									detailUrl: proxied.detailUrl || buildFalenoWorksUrl(code),
									contentId: proxied.cid || toFalenoCodeKey(code),
									title: proxied.title,
									shortTitle: proxied.shortTitle,
									coverUrl: proxied.coverUrl,
									previewUrl: proxied.previewUrl,
									previewType: "mp4",
								} satisfies PreviewMedia;
							}
							const worksUrl = buildFalenoWorksUrl(code);
							if (!worksUrl) return null;
							let res: Response;
							try {
								res = await fetch(worksUrl, {
									signal: AbortSignal.timeout(5000),
								});
							} catch (error) {
								throw {
									source: "faleno",
									kind:
										error instanceof Error &&
										error.name === "TimeoutError"
											? "timeout"
											: "network",
								} satisfies PreviewLookupError;
							}
							// 404 状态码 = 作品不存在，按查无处理（返回 null）；以 200 返回的
							// 「ページが見つかりませんでした」页面由 parseFalenoWorksHtml 识别为查无。
							// 其余非 2xx（如 WAF 403）仍视为错误
							if (res.status === 404) return null;
							if (!res.ok) {
								throw {
									source: "faleno",
									kind: "http",
									status: res.status,
								} satisfies PreviewLookupError;
							}
							const html = await res.text();
							const data = parseFalenoWorksHtml(html);
							if (!data) return null;
							return {
								source: "faleno",
								detailUrl: worksUrl,
								contentId: toFalenoCodeKey(code),
								title: data.title,
								shortTitle: data.shortTitle,
								coverUrl: data.coverUrl,
								previewUrl: data.previewUrl,
								previewType: "mp4",
							} satisfies PreviewMedia;
						},
					});
					sendResponse({
						...resolution,
						...resolution.media,
						source: resolution.media?.source ?? null,
						detailUrl: resolution.media?.detailUrl ?? null,
						contentId: resolution.media?.contentId ?? null,
						title: resolution.media?.title ?? null,
						shortTitle: resolution.media?.shortTitle ?? null,
						coverUrl: resolution.media?.coverUrl ?? null,
						previewUrl: resolution.media?.previewUrl ?? null,
						previewType: resolution.media?.previewType ?? null,
					});
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
