/**
 * 本地跑 Vercel 函数 handler（mock req/res），验证服务端全链路。
 *
 * 三组确定性断言（用 test/fixtures 里的真实页面固件桩掉上游 fetch）：
 *   1. 命中：返回与 DMM 同形状的 JSON，字段与固件一致
 *   2. 上游 404 → 40401 ITEM_NOT_FOUND
 *   3. 上游 200 但内容为「ページが見つかりませんでした」→ 同样 40401
 * 再加一次真实网络调用（仅作参考：国内出口访问 faleno.jp 本身就不稳定，权威验证在 hnd1 部署上做）。
 *
 * 前置：advanced/dmm-api/vercel-dmm/node_modules 已安装（npm install --prefix advanced/dmm-api/vercel-dmm）
 * 用法：node tools/vercel-local-handler.mjs
 */

import { readFileSync } from "node:fs";
import handler from "../advanced/dmm-api/vercel-dmm/api/index.js";

const fixtureOk = readFileSync(
	new URL("../test/fixtures/FNS263.html", import.meta.url),
	"utf8",
);
const fixtureNotFound = readFileSync(
	new URL("../test/fixtures/FNS265.html", import.meta.url),
	"utf8",
);

const realFetch = globalThis.fetch;

async function call(query) {
	const result = { status: null, body: null };
	const res = {
		setHeader() {},
		status(statusCode) {
			this._status = statusCode;
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

/** 只桩掉 faleno 作品页请求，其余（如 DMM GraphQL）走真实网络 */
function stubFaleno(html, status = 200) {
	globalThis.fetch = async (url, init) => {
		if (String(url).includes("faleno.jp/top/works/")) {
			return new Response(html, {
				status,
				headers: { "content-type": "text/html; charset=UTF-8" },
			});
		}
		return realFetch(url, init);
	};
}

let failed = 0;
function check(label, actual, expected) {
	const ok = actual === expected;
	if (!ok) failed += 1;
	console.log(`${ok ? "PASS" : "FAIL"}  ${label}: ${JSON.stringify(actual)}${ok ? "" : ` (期望 ${JSON.stringify(expected)})`}`);
}

console.log("=== 1) 命中（真实 FNS-263 固件）===");
stubFaleno(fixtureOk);
const hit = await call({ code: "FNS-263", only: "faleno" });
check("status", hit.status, 200);
check("code", hit.body?.code, "FNS-263");
check("cid", hit.body?.cid, "fns263");
check("channel", hit.body?.channel, "faleno");
check(
	"preview_url",
	hit.body?.preview_url,
	"https://cdn.faleno.net/top/wp-content/uploads/2026/09/FNS-263_PR.mp4",
);
check(
	"cover_url",
	hit.body?.cover_url,
	"https://cdn.faleno.net/top/wp-content/uploads/2026/09/FNS-263_1200.jpg?output-quality=60",
);
check(
	"short_title",
	hit.body?.short_title,
	"【汗・潮・淫汁・お漏らし】柏木【雫】を搾り尽くす体液ダダ洩れアクメ覚醒SEX 柏木雫",
);
check(
	"title",
	hit.body?.title,
	"撮影を重ねるごとにエロくなっていく柏木雫ちゃんの汗、潮、マ〇汁、更にはヨダレ、涙まで全てを搾り尽くして味わい尽くす1本！スレンダーなピュアボディがドロドロの体液まみれでイキ狂う姿をお楽しみください。",
);
check("detail_url", hit.body?.detail_url, "https://faleno.jp/top/works/fns263/");
// 封面浮条三个新字段（spec §4.2）：出演者数组 + 两个原始抓取值日期
check("actresses", JSON.stringify(hit.body?.actresses), JSON.stringify(["柏木雫"]));
check("delivery_date", hit.body?.delivery_date, "2026/10/2");
check("sale_date", hit.body?.sale_date, "2026/11/05");
check("cached", hit.body?.cached, false);

console.log("=== 2) 上游 404 ===");
stubFaleno(fixtureNotFound, 404);
const nf404 = await call({ code: "FSDSS-999", only: "faleno" });
check("status", nf404.status, 404);
check("error", nf404.body?.error, "ITEM_NOT_FOUND");
check("code", nf404.body?.code, 40401);

console.log("=== 3) 上游 200 + 「ページが見つかりませんでした」页面 ===");
stubFaleno(fixtureNotFound, 200);
const nf200 = await call({ code: "FSDSS-999", only: "faleno" });
check("status", nf200.status, 404);
check("error", nf200.body?.error, "ITEM_NOT_FOUND");

console.log("=== 4) DMM cid 分支回归（真实网络）===");
globalThis.fetch = realFetch;
const dmm = await call({ code: "BDSM-091", only: "cid" });
check("status", dmm.status, 200);
check("channel", dmm.body?.channel, "digital");
console.log(`     cid=${dmm.body?.cid}`);

console.log("=== 5) 真实网络直连 faleno（仅供参考，国内出口不稳定）===");
const real = await call({ code: "FNS-263", only: "faleno" });
console.log(
	`     status=${real.status} channel=${real.body?.channel ?? "-"} message=${real.body?.message ?? "-"}`,
);
console.log("     （权威验证走 hnd1 生产部署，见计划 Task 5）");

console.log(failed === 0 ? "=== 全部断言通过 ===" : `=== 有 ${failed} 条断言失败 ===`);
process.exit(failed === 0 ? 0 : 1);
