/**
 * 生产环境复测。
 *
 *   node smoke-prod.mjs https://<base> <API_KEY> [--token-file]
 *
 * 检查项：鉴权、四个已知番号、分隔符兜底、缓存命中、批量部分成功、部署区域。
 */

import fs from "node:fs";

const base = (process.argv[2] || "").replace(/\/$/, "");
const key = process.argv[3] || "";
if (!base || !key) {
	console.error("用法: node smoke-prod.mjs <base> <API_KEY>");
	process.exit(1);
}

const L = (s) => console.log(s);
const pad = (s, n) => String(s ?? "-").padEnd(n);

async function call(path) {
	const started = Date.now();
	const res = await fetch(`${base}${path}`);
	let body = null;
	try {
		body = await res.json();
	} catch {
		/* 非 JSON */
	}
	return {
		status: res.status,
		body,
		ms: Date.now() - started,
		region: res.headers.get("x-vercel-id") || "",
		cache: res.headers.get("cache-control") || "",
		edge: res.headers.get("x-vercel-cache") || "",
	};
}

L(`目标: ${base}\n`);
let pass = 0;
let fail = 0;
const check = (ok, label, detail) => {
	ok ? pass++ : fail++;
	L(`${ok ? "✅" : "❌"} ${pad(label, 34)} ${detail}`);
};

// 0) 根路径不得泄漏接口（与 dmm-api 一致：回 404）
{
	const r = await fetch(`${base}/`);
	const text = await r.text();
	check(
		r.status === 404 && !/MISSING_API_KEY|请提供|ITEM_NOT_FOUND/.test(text),
		"根路径返回 404（不泄漏接口）",
		`${r.status} ct=${(r.headers.get("content-type") || "-").split(";")[0]} len=${text.length}`,
	);
}

// 0.1) 部署区域
{
	const r = await call(`/HEYZO-3953?key=${encodeURIComponent(key)}`);
	check(Boolean(r.region), "部署区域 (x-vercel-id)", r.region || "(无头)");
	check(r.status === 200, "HEYZO-3953 首次查询", `${r.status} ${r.ms}ms site=${r.body?.site_id} quality=${r.body?.preview_quality}`);
	if (r.body?.preview_url) L(`     preview: ${r.body.preview_url}`);
	if (r.body?.d2pass_url) L(`     d2pass : ${r.body.d2pass_url}`);
	if (r.body?.short_title) L(`     title  : ${r.body.short_title}`);

	// 字段口径：short_title = 标题（短，金色行），title = 剧情介绍（长，灰色行）
	check(
		Boolean(r.body?.short_title) && typeof r.body?.title === "string" && r.body.title.length > r.body.short_title.length,
		"short_title=标题 / title=剧情",
		`short=${r.body?.short_title?.length ?? 0}字 title=${r.body?.title?.length ?? 0}字`,
	);

	// 缓存命中（同一实例）
	// 注意：第二次必须换 cache-buster。若用同一个 URL，会被 CDN 的边缘缓存直接接住，
	// 返回的是第一次的响应体（cached:false），根本进不了函数，测不到 Redis/内存这一层。
	const r2 = await call(`/HEYZO-3953?key=${encodeURIComponent(key)}&_=cb${Date.now()}`);
	check(r2.body?.cached === true, "换 URL 绕开 CDN 后命中缓存", `cached=${r2.body?.cached} ${r2.ms}ms  edge=${r2.edge}`);
}

// 1) refresh=1 / debug=1
{
	const r = await call(`/HEYZO-3953?key=${encodeURIComponent(key)}&refresh=1&debug=1&_=rf${Date.now()}`);
	const d = r.body?.debug || {};
	check(
		r.status === 200 && d.refresh === true && !r.body?.cached,
		"refresh=1 绕过缓存 + debug=1 返回中间状态",
		`cached=${r.body?.cached} refresh=${d.refresh} backend=${d.backend} ${r.ms}ms`,
	);
	check(/no-store/.test(r.cache), "refresh/debug 响应不被 CDN 缓存", r.cache || "(无 Cache-Control)");
	if (d.candidates) L(`     debug: candidates=${JSON.stringify(d.candidates)} site=${d.site} elapsed=${d.elapsedMs}ms`);

	const r2 = await call(`/HEYZO-3953?key=${encodeURIComponent(key)}&_=after${Date.now()}`);
	check(r2.body?.cached === true, "refresh 后已回写缓存", `cached=${r2.body?.cached} ${r2.ms}ms`);

	const r3 = await call(`/IPX-118?key=${encodeURIComponent(key)}&debug=1&_=c${Date.now()}`);
	check(
		r3.status === 404 && r3.body?.debug?.cacheSkipped === true,
		"有码号 + debug=1 也带中间状态",
		`${r3.status} class=${r3.body?.class} cacheSkipped=${r3.body?.debug?.cacheSkipped}`,
	);
}

// 1.1) quality= 与 no_preview= （都要确认不会污染该番号的缓存口径）
{
	const a = await call(`/100126_01?key=${encodeURIComponent(key)}&quality=240p&_=q1${Date.now()}`);
	check(a.status === 200 && a.body?.preview_quality === "240p", "quality=240p 覆盖生效", `quality=${a.body?.preview_quality}`);

	const b = await call(`/100126_01?key=${encodeURIComponent(key)}&_=q2${Date.now()}`);
	check(b.body?.preview_quality === "480p", "默认口径未被 quality 请求污染", `quality=${b.body?.preview_quality} cached=${b.body?.cached}`);

	// 加 refresh=1 强制重抓：否则若该番号已有完整缓存，会被合法复用（复用是对的，但测不到"跳过"逻辑）
	const c = await call(`/HEYZO-3950?key=${encodeURIComponent(key)}&no_preview=1&refresh=1&_=np1${Date.now()}`);
	check(
		c.status === 200 && c.body?.preview_url === null && Boolean(c.body?.short_title),
		"no_preview=1 跳过预告片（强制重抓验证）",
		`preview=${c.body?.preview_url} short=${c.body?.short_title?.slice(0, 14)}…`,
	);

	const d = await call(`/HEYZO-3950?key=${encodeURIComponent(key)}&_=np2${Date.now()}`);
	check(Boolean(d.body?.preview_url), "残缺条目未污染默认口径", `preview=${d.body?.preview_url ? "有" : "无"} cached=${d.body?.cached}`);
}

// 2) 其余已知番号 + 分隔符兜底
for (const [code, expectSite] of [
	["HEYZO-3951", "heyzo"],
	["100126-100", "pacopacomama"],
	["100426-001", "caribbeancom"],
	["100326_01", "10musume"],
	["100426_1267", "muramura"],
]) {
	const r = await call(`/api?code=${encodeURIComponent(code)}&key=${encodeURIComponent(key)}`);
	check(r.status === 200 && r.body?.site_id === expectSite, `${code}`, `${r.status} ${r.ms}ms site=${r.body?.site_id} quality=${r.body?.preview_quality}`);
}

// 2) 鉴权 / 参数
{
	const a = await call(`/HEYZO-3953`);
	check(a.status === 401 && a.body?.error === "MISSING_API_KEY", "无 key -> 401", `${a.status} ${a.body?.error}`);
	const b = await call(`/HEYZO-3953?key=wrong`);
	check(b.status === 403 && b.body?.error === "INVALID_API_KEY", "错误 key -> 403", `${b.status} ${b.body?.error}`);
	const c = await call(`/NOPE-000?key=${encodeURIComponent(key)}`);
	check(c.status === 404 && c.body?.error === "ITEM_NOT_FOUND", "未知番号 -> 404", `${c.status} ${c.body?.error}`);
}

// 3) 批量
{
	const codes = ["HEYZO-3953", "100126-100", "100426-001", "QQQ-000"];
	const r = await call(`/batch?codes=${codes.join(",")}&key=${encodeURIComponent(key)}`);
	const n = Object.keys(r.body?.results || {}).length;
	const e = Object.keys(r.body?.errors || {}).length;
	check(r.status === 200 && n === 3 && e === 1, "批量部分成功", `${r.status} ${r.ms}ms results=${n} errors=${e}`);
}

// 4) 地域受限站复测（东京出口的核心悬念）
for (const [label, code] of [
	["女体のしんぴ(地域)", "n3351"],
	["金髪天國(地域)", "3997"],
]) {
	const r = await call(`/api?code=${encodeURIComponent(code)}&key=${encodeURIComponent(key)}`);
	L(`${r.status === 200 ? "🎉" : "ℹ️"} ${pad(label, 34)} ${r.status} ${r.ms}ms site=${r.body?.site_id || r.body?.error}`);
}

L(`\n通过 ${pass}，失败 ${fail}`);
