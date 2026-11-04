/**
 * HTTP 基座：带超时的 fetch、按 charset 解码、轻量存在性探测。
 *
 * 生产代码只用 Web 标准 fetch（Vercel Node 20/22 原生可用），不引第三方 HTTP 库。
 * 注意：不要手工设置 Accept-Encoding —— 交给 undici 自己协商并解压，否则可能拿到未解压的字节。
 */

const UA =
	"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const DEFAULT_HEADERS = {
	"User-Agent": UA,
	"Accept-Language": "ja,en;q=0.8,zh-CN;q=0.6",
};

/** 带超时的原始请求，返回 { status, headers, buffer, finalUrl } */
export async function fetchRaw(url, { method = "GET", headers = {}, timeoutMs = 8000, body, dispatcher } = {}) {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	try {
		const res = await fetch(url, {
			method,
			body,
			redirect: "follow",
			signal: controller.signal,
			...(dispatcher ? { dispatcher } : {}),
			headers: { ...DEFAULT_HEADERS, ...headers },
		});
		const buffer = Buffer.from(await res.arrayBuffer());
		return { status: res.status, headers: res.headers, buffer, finalUrl: res.url || url };
	} finally {
		clearTimeout(timer);
	}
}

/**
 * 预留的按站点代理出口（受限站点用，本期未启用）。
 *
 * 配置 `SITE_PROXY_<SITE_ID>`（大写、`-` 换 `_`）即生效，例如
 * `SITE_PROXY_NYOSHIN=http://user:pass@host:port` 或 `socks5://…`。
 * 需要 undici 的 ProxyAgent；未安装时只告警并直连，不影响其余站点。
 */
const dispatcherCache = new Map();
export async function siteDispatcher(siteId) {
	const key = `SITE_PROXY_${siteId.toUpperCase().replace(/-/g, "_")}`;
	const proxyUrl = process.env[key];
	if (!proxyUrl) return undefined;
	if (dispatcherCache.has(key)) return dispatcherCache.get(key);
	let dispatcher;
	try {
		const { ProxyAgent } = await import("undici");
		dispatcher = new ProxyAgent(proxyUrl);
	} catch (err) {
		console.warn(`[http] ${key} 已配置但 undici 不可用，本次直连：${err?.message || err}`);
		dispatcher = undefined;
	}
	dispatcherCache.set(key, dispatcher);
	return dispatcher;
}

/**
 * 按响应头 charset 解码；日文源站大量使用 EUC-JP，解错就是乱码。
 *
 * `override`：源站既不声明 Content-Type charset、页面里也没有 `<meta charset>` 时，
 * 由适配器显式指定（例：caribbeancompr 实测是 EUC-JP 却什么都不声明，回落 UTF-8 就是乱码）。
 */
export function decodeBody(buffer, contentType, override) {
	const charset = (/charset=([\w-]+)/i.exec(contentType || "") || [])[1] || override;
	const enc = (charset || "utf-8").toLowerCase();
	try {
		return new TextDecoder(enc).decode(buffer);
	} catch {
		return buffer.toString("utf8");
	}
}

export async function fetchText(url, options = {}) {
	const res = await fetchRaw(url, options);
	return { ...res, text: decodeBody(res.buffer, res.headers.get("content-type"), options.charset) };
}

export async function fetchJson(url, options = {}) {
	const res = await fetchText(url, options);
	let json = null;
	try {
		json = JSON.parse(res.text);
	} catch {
		/* 非 JSON 一律当失败，调用方按 status 判断 */
	}
	return { ...res, json };
}

/**
 * 存在性探测：只关心"这个 URL 有没有内容"，不下载整页。
 * HEAD 优先；部分站点不支持 HEAD，退化为 Range GET（1 KB）。
 * 返回 true 表示 2xx。
 */
export async function probeExists(url, options = {}) {
	return (await probeStatus(url, options)) === "ok";
}

/**
 * 带状态的探测：**必须区分"确认不存在"与"探测本身失败"**。
 *
 * 这个区分至关重要：番号的路由有歧义时会并发探测多个站，若把"超时/5xx"当成
 * "不存在"，就会被误判为需要退到分隔符兄弟形态，从而在**另一个站上命中同数字的另一部影片**。
 *
 * - `ok`：2xx
 * - `notfound`：404 / 410（确认没有）
 * - `error`：超时、网络错误、5xx、其它不确定状态
 */
export async function probeStatus(url, { timeoutMs = 6000, referer } = {}) {
	const headers = referer ? { Referer: referer } : {};
	const classify = (status) => {
		if (status >= 200 && status < 300) return "ok";
		if (status === 404 || status === 410) return "notfound";
		// 403 / 429 是 WAF 拦或风控限流，不是"这个号不存在"：
		// 判成 notfound 会让大陆出口的每个号都显示"查无"，且误导路由去试兄弟形态
		if (status === 403 || status === 429) return "error";
		if (status >= 500) return "error";
		return "notfound";
	};
	try {
		const head = await fetchRaw(url, { method: "HEAD", headers, timeoutMs });
		if (head.status >= 200 && head.status < 300) return "ok";
		if (head.status === 404 || head.status === 410) return "notfound";
		if (head.status >= 500) return "error";
		if (head.status !== 405 && head.status !== 501 && head.status !== 403) return "notfound";
	} catch {
		/* HEAD 不可用或网络抖动：继续尝试 Range GET 再定性 */
	}
	try {
		const ranged = await fetchRaw(url, { headers: { ...headers, Range: "bytes=0-1023" }, timeoutMs });
		return classify(ranged.status);
	} catch {
		return "error";
	}
}

/** 从 HTML 里抽第一个可播的预告片地址（优先 mp4，其次 m3u8） */
export function extractMediaFromHtml(html) {
	if (!html) return null;
	const urls = [
		...new Set(
			[...html.matchAll(/https?:\/\/[^"'\s\\)<>]+\.(?:mp4|m3u8)[^"'\s\\)<>]*/gi)].map((m) =>
				m[0].replace(/&amp;/g, "&"),
			),
		),
	].filter((u) => !/\.(?:jpg|jpeg|png|webp|gif)$/i.test(u));
	if (urls.length === 0) return null;
	const hls = urls.find((u) => /\.m3u8/i.test(u));
	const mp4 = urls.filter((u) => /\.mp4/i.test(u));
	return { mp4, hls: hls || null, all: urls };
}

/** HTML 实体解码（标题/剧情里大量出现 &amp; / &quot; / &#39;） */
export function decodeEntities(s) {
	return String(s ?? "")
		.replace(/&amp;/g, "&")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&#0?39;/g, "'")
		.replace(/&nbsp;/g, " ")
		.trim();
}

/** HTML 片段 → 纯文本（去标签、解码实体、压缩空白）。用于剧情介绍这类富文本字段。 */
export function htmlToText(html) {
	if (!html) return "";
	return decodeEntities(
		String(html)
			.replace(/<br\s*\/?>/gi, " ")
			.replace(/<[^>]+>/g, " "),
	)
		.replace(/\s+/g, " ")
		.trim();
}
