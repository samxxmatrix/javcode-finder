/**
 * 反代 mono 元数据解析的确定性检查：用真实固件桩掉全部上游，断言 DMM 商品情報テーブル
 * 里的出演者 / 発売日 被正确抽成 `actresses` / `sale_date`。
 *
 * 固件：test/fixtures/dmm-mono-BDSM-091.html
 *   —— 2026-10-10 用 tools/probe-dmm-detail.mjs 抓的**真实 mono 详情页**
 *   （age_check 302 → age_check_done cookie → 详情页 200 / 261 KB）。
 *   实测标记：`<td class="nw">出演者：</td><td><span id="performer"><a …>宮西ひかる</a>`、
 *   `<td class="nw">発売日：</td><td>2026/09/25</td>`（mono 页**没有**配信開始日）。
 *
 * 前置：advanced/dmm-api/vercel-dmm/node_modules 已安装
 * 用法：node tools/dmm-mono-meta-check.mjs
 */
import { readFileSync } from "node:fs";
import handler from "../advanced/dmm-api/vercel-dmm/api/index.js";
import { SCHEMA_VERSION } from "../advanced/dmm-api/vercel-dmm/lib/cache-entry.js";

const fixture = readFileSync(
	new URL("../test/fixtures/dmm-mono-BDSM-091.html", import.meta.url),
	"utf8",
);

const realFetch = globalThis.fetch;

function jsonResponse(body, status = 200) {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json" },
	});
}
function htmlResponse(body, status = 200) {
	return new Response(body, {
		status,
		headers: { "content-type": "text/html; charset=UTF-8" },
	});
}

// 全桩：GraphQL 空结果 → 回落 mono 搜索 → 命中 mono cid → 详情境件
globalThis.fetch = async (url, init) => {
	const target = String(url);
	if (target.includes("api.video.dmm.co.jp/graphql")) {
		return jsonResponse({ data: { legacySearchPPV: { result: { contents: [] } } } });
	}
	if (target.includes("/age_check/")) {
		return new Response("", {
			status: 302,
			headers: { "set-cookie": "age_check_done=1; Path=/" },
		});
	}
	if (target.includes("/mono/-/search/")) {
		return htmlResponse(
			'<a href="/mono/dvd/-/detail/=/cid=h_1096bdsm091/">候補</a>',
		);
	}
	if (target.includes("/mono/dvd/-/detail/")) {
		return htmlResponse(fixture);
	}
	return realFetch(url, init);
};

async function call(query) {
	const result = { status: null, body: null };
	const res = {
		setHeader() {},
		status(code) {
			this._status = code;
			return this;
		},
		json(data) {
			result.status = this._status;
			result.body = data;
		},
	};
	await handler({ method: "GET", query, headers: {} }, res);
	return result;
}

let failed = 0;
function check(label, actual, expected) {
	const ok = actual === expected;
	if (!ok) failed += 1;
	console.log(
		`${ok ? "PASS" : "FAIL"}  ${label}: ${JSON.stringify(actual)}${ok ? "" : ` (期望 ${JSON.stringify(expected)})`}`,
	);
}

console.log("=== mono 通道：真实固件 → 出演者 / 発売日 ===");
const hit = await call({ code: "BDSM-091" });
check("status", hit.status, 200);
check("channel", hit.body?.channel, "mono");
check("v", hit.body?.v, SCHEMA_VERSION);
check("cid", hit.body?.cid, "h_1096bdsm091");
check("actresses", JSON.stringify(hit.body?.actresses), JSON.stringify(["宮西ひかる"]));
check("sale_date", hit.body?.sale_date, "2026/09/25");
check("delivery_date", hit.body?.delivery_date, null);
check(
	"cover_url",
	hit.body?.cover_url,
	"https://pics.dmm.co.jp/mono/movie/adult/h_1096bdsm091/h_1096bdsm091pl.jpg",
);

console.log(`\n${failed === 0 ? "全部 PASS" : `${failed} 项 FAIL`}`);
process.exitCode = failed === 0 ? 0 : 1;
