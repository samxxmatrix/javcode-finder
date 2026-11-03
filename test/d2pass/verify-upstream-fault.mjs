/**
 * 回归：上游故障必须与"确认不存在"严格区分，且 caribbeancompr 不得乱码。
 *
 *   node verify-upstream-fault.mjs
 *
 * ① 把源站超时压到 1ms 制造"上游不可达"：
 *    必须返回 503 SOURCE_UNAVAILABLE，**不能**返回 404，更不能退到分隔符兄弟形态
 *    在另一个站上命中同数字的另一部影片。
 * ② 正常超时下 100426-001 应解析到 caribbeancom（它是 `-`+3 位，与 caribbeancompr 无关）。
 * ③ caribbeancompr 不声明 charset，适配器里的 euc-jp 提示必须真的生效。
 */

const L = (s) => console.log(s);
let pass = 0;
let fail = 0;
const check = (ok, label, detail) => {
	ok ? pass++ : fail++;
	L(`${ok ? "✅" : "❌"} ${label.padEnd(52)} ${detail}`);
};

// ---------- ① 上游不可达 → 503，不猜 ----------
process.env.API_KEY = "fault-key";
process.env.SOURCE_TIMEOUT_MS = "1";
delete process.env.REDIS_URL;

const { default: handler } = await import("../../advanced/d2pass-api/vercel-d2pass/api/index.js");
const mk = () => ({
	statusCode: 200,
	headers: {},
	body: null,
	setHeader(k, v) {
		this.headers[k.toLowerCase()] = v;
	},
	end(p) {
		this.body = p ? JSON.parse(p) : null;
	},
});
const call = async (url) => {
	const res = mk();
	await handler({ method: "GET", url, headers: { host: "localhost" } }, res);
	return res;
};

{
	const r = await call(`/api?code=100426-001&key=fault-key&debug=1`);
	check(
		r.statusCode === 503 && r.body?.error === "SOURCE_UNAVAILABLE",
		"源站超时 → 503 SOURCE_UNAVAILABLE（不是 404）",
		`${r.statusCode} ${r.body?.error}`,
	);
	check(r.headers["retry-after"] === "5", "503 带 Retry-After", `Retry-After=${r.headers["retry-after"] || "(无)"}`);
	check(
		!r.body?.debug?.alternateCode && r.body?.debug?.upstreamError,
		"未退到分隔符兄弟形态（避免命中另一部影片）",
		`alternateCode=${r.body?.debug?.alternateCode || "无"} upstreamError=${r.body?.debug?.upstreamError || "无"}`,
	);
	// 关键：不能被负缓存，否则该番号 6 小时内一直 404
	const r2 = await call(`/api?code=100426-001&key=fault-key&debug=1`);
	check(r2.body?.debug?.negativeCacheHit !== true, "上游故障不写负缓存", `negativeCacheHit=${r2.body?.debug?.negativeCacheHit ?? false}`);
}

// ---------- ② 正常超时下仍解析到 caribbeancom ----------
process.env.SOURCE_TIMEOUT_MS = "9000";
{
	const r = await call(`/api?code=100426-001&key=fault-key&refresh=1`);
	check(r.statusCode === 200 && r.body?.site_id === "caribbeancom", "正常超时下解析到 caribbeancom", `${r.statusCode} site=${r.body?.site_id}`);
}

// ---------- ③ probeStatus / siteExists 三态 ----------
const { probeStatus } = await import("../../advanced/d2pass-api/vercel-d2pass/api/lib/http.js");
const { siteExists, resolveSite } = await import("../../advanced/d2pass-api/vercel-d2pass/api/lib/sites.js");
{
	const err = await probeStatus("https://host-that-does-not-exist.invalid/x", { timeoutMs: 3000 });
	check(err === "error", "不可达主机 → probeStatus=error", `得到 ${err}`);
	const nf = await probeStatus("https://www.d2pass.com/product/movies/999999999", { timeoutMs: 8000 });
	check(nf === "notfound", "不存在的商品页 → notfound", `得到 ${nf}`);

	const ok = await siteExists("caribbeancom", "100426-001", { timeoutMs: 9000 });
	check(ok === "ok", "siteExists 命中 → ok", `得到 ${ok}`);
}

// ---------- ④ caribbeancompr 字符集 ----------
{
	const s = await resolveSite("caribbeancompr", "100426_001", { timeoutMs: 9000 }).catch(() => null);
	const title = s?.title || "";
	const mojibake = title.includes("\uFFFD") || /[ÃÂ¤¥]/.test(title);
	check(
		Boolean(title) && !mojibake && /[\u3040-\u30ff\u4e00-\u9fff]/.test(title),
		"caribbeancompr 标题不乱码（euc-jp 提示生效）",
		title ? title.slice(0, 34) : "(未取到)",
	);
}

L(`\n通过 ${pass}，失败 ${fail}`);
