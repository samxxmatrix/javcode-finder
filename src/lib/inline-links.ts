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

/**
 * 中文/全角标点 → 半角英文符号。
 * 微软兜底翻译会把属性引号改成弯引号（`href=“http://…”`），原 HREF_RE 只认直引号，
 * 取不到 href 就整段降级为纯文本、面板直接露出源码（2026-11-19 MIMK-047 实测）。
 * 产品要求统一半角显示，因此对整段生效，正文标点也随之变化。
 */
const PUNCT_MAP: Record<string, string> = {
	"‘": "'",
	"’": "'",
	"“": '"',
	"”": '"',
	"「": '"',
	"」": '"',
	"『": "'",
	"』": "'",
	"、": ",",
	"。": ".",
	"【": "[",
	"】": "]",
	"〔": "[",
	"〕": "]",
	"〖": "[",
	"〗": "]",
	"《": "<",
	"》": ">",
	"〈": "<",
	"〉": ">",
	"…": "...",
	"〜": "~",
	"—": "-",
};

// 全角 ASCII（！-～）与全角空格按码位换算，其余中文标点查表。
// 刻意不含日文长音符「ー」(U+30FC)、中点「・」(U+30FB) 与遮蔽符「●」——它们是正文字符，不是标点。
const HALF_WIDTH_RE =
	/[\u3000\uFF01-\uFF5E\u2018\u2019\u201C\u201D\u300C\u300D\u300E\u300F\u3001\u3002\u3010\u3011\u3014\u3015\u3016\u3017\u300A\u300B\u3008\u3009\u2026\u301C\u2014]/g;

function toHalfWidthPunctuation(text: string): string {
	return text.replace(HALF_WIDTH_RE, (ch) => {
		const code = ch.charCodeAt(0);
		if (code === 0x3000) return " ";
		// 全角 ASCII 与半角 ASCII 相差固定 0xFEE0
		if (code >= 0xff01 && code <= 0xff5e) {
			return String.fromCharCode(code - 0xfee0);
		}
		return PUNCT_MAP[ch] ?? ch;
	});
}

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
 * 一个 `<a>` 标签最多允许跨的行数（含起始行）。
 * 超过即视为未闭合的脏数据，整段按纯文本处理，避免坏标签吞掉后面整段正文。
 */
const MAX_ANCHOR_SPAN_LINES = 5;

/**
 * 续行合并被换行劈开的 `<a>` 标签。
 * dmm 等源站存在 `<a\n href="…">` 的写法，译文也可能在属性之间插换行；
 * 若先分行再解析，两侧都不成对，整段会降级为纯文本（面板露出源码）。
 * 只在「`<a` 多于 `</a>`」时用空格把下一行接上，正常文本逐行原样输出、行数不变。
 */
function mergeBrokenAnchors(text: string): string {
	const merged: string[] = [];
	let buffer: string | null = null;
	let unresolved = 0;
	let spanned = 0;
	for (const line of text.split("\n")) {
		buffer = buffer === null ? line : `${buffer} ${line}`;
		spanned += 1;
		unresolved +=
			(line.match(/<a\b/gi) ?? []).length -
			(line.match(/<\/a\s*>/gi) ?? []).length;
		if (unresolved <= 0 || spanned >= MAX_ANCHOR_SPAN_LINES) {
			merged.push(buffer);
			buffer = null;
			unresolved = 0;
			spanned = 0;
		}
	}
	if (buffer !== null) merged.push(buffer);
	return merged.join("\n");
}

/**
 * 把标题/介绍切成「行 → 片段」：统一 \r\n 与 `<br>`、过滤空行，并在每行内恢复链接。
 * 原文与译文共用同一入口，译文里只要标签还在就自动恢复；标签被翻译器吃掉时
 * 整行退回纯文本（best-effort，不报错、不做占位符映射）。
 * 全角标点先统一为半角：既满足显示口径，也让被改成弯引号的属性重新可解析。
 * 跨行的 `<a>` 在分行前先续行合并，避免标签被劈开后解析失败。
 */
export function parseTitleLines(text: string): InlineSegment[][] {
	const normalized = toHalfWidthPunctuation(decodeInlineEntities(text))
		.replace(/\r\n?/g, "\n")
		.replace(/<br\b[^>]*>/gi, "\n");
	return mergeBrokenAnchors(normalized)
		.split("\n")
		.filter((line) => line.trim() !== "")
		.map((line) => parseInlineLinks(line));
}
