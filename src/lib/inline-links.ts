/**
 * 标题/介绍里内嵌 `<a>` 的安全解析。
 *
 * 源站简介与译文都可能带 HTML 字面量；这里只把可校验的 http(s) 链接还原成
 * 结构化片段，其余一律按文本返回，由 React 自行转义，不使用 innerHTML。
 */

/** 渲染片段：纯文本或可点击链接 */
export type InlineSegment =
	| { type: "text"; text: string }
	| { type: "link"; href: string; text: string };

// 翻译器可能把标签实体化（项目实测谷歌/微软会改写 <code> 标记），
// 先还原成字符再统一解析。&amp; 放最后，避免 &amp;lt; 被二次解成标签。
const ENTITY_REPLACERS: Array<[RegExp, string]> = [
	[/&lt;/gi, "<"],
	[/&gt;/gi, ">"],
	[/&quot;/gi, '"'],
	[/&#39;|&apos;/gi, "'"],
	[/&amp;/gi, "&"],
];

const ANCHOR_RE = /<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi;
const HREF_RE = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i;

function decodeInlineEntities(text: string): string {
	return ENTITY_REPLACERS.reduce((s, [re, value]) => s.replace(re, value), text);
}

/** 只放行绝对 http(s) 地址；相对路径、危险协议与被翻译器改坏的 URL 一律拒绝 */
function safeHref(raw: string): string | null {
	const href = raw.trim();
	if (!/^https?:\/\//i.test(href) || /\s/.test(href)) return null;
	try {
		const url = new URL(href);
		if (url.protocol !== "http:" && url.protocol !== "https:") return null;
	} catch {
		return null;
	}
	return href;
}

function parseInlineLinks(line: string): InlineSegment[] {
	const segments: InlineSegment[] = [];
	let cursor = 0;
	const pushText = (text: string): void => {
		if (text) segments.push({ type: "text", text });
	};
	for (const match of line.matchAll(ANCHOR_RE)) {
		const at = match.index ?? 0;
		const hrefMatch = HREF_RE.exec(match[1] ?? "");
		const href = hrefMatch
			? safeHref(hrefMatch[1] ?? hrefMatch[2] ?? hrefMatch[3] ?? "")
			: null;
		// 不安全/畸形的标签不切分：整段原样留给文本，内容不丢
		if (!href) continue;
		pushText(line.slice(cursor, at));
		segments.push({ type: "link", href, text: match[2] ?? "" });
		cursor = at + match[0].length;
	}
	pushText(line.slice(cursor));
	return segments;
}

/**
 * 把标题/介绍切成「行 → 片段」：统一 \r\n 与 `<br>`、过滤空行，并在每行内恢复链接。
 * 原文与译文共用同一入口，译文里只要标签还在就自动恢复；标签被翻译器吃掉时
 * 整行退回纯文本（best-effort，不报错、不做占位符映射）。
 */
export function parseTitleLines(text: string): InlineSegment[][] {
	const normalized = decodeInlineEntities(text)
		.replace(/\r\n?/g, "\n")
		.replace(/<br\b[^>]*>/gi, "\n");
	return normalized
		.split("\n")
		.filter((line) => line.trim() !== "")
		.map((line) => parseInlineLinks(line));
}
