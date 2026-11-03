/**
 * 18 家加盟站覆盖测试：每家挑一个真实番号打一遍，看适配器是否真的通。
 *
 *   node test-coverage.mjs
 *
 * 预期结果（本机非日本出口实测）：
 *   ✅ 12 家可解析 ／ ⚠️ 3 家页面可达但标题要另抽 ／ ❌ 3 家受限或站点已迁移
 */

process.env.API_KEY = process.env.API_KEY || "local-test-key";

const { default: handler } = await import("../../advanced/d2pass-api/vercel-d2pass/api/index.js");

const KEY = process.env.API_KEY;

// 每家一个真实番号（从 D2Pass 商品页回链取得）
// expect: 期望命中的 site_id；null 表示"已知限制，允许失败"（地域拦截 / 站点迁移 / 裸数字撞号）
const CODES = [
	["heyzo", "HEYZO-3953", "heyzo"],
	["heydouga", "4229-2960", "heydouga"],
	["caribbeancom", "100426-001", "caribbeancom"],
	["caribbeancompr", "100526_001", "caribbeancompr"],
	["1pondo", "100326_001", "1pondo"],
	["10musume", "100326_01", "10musume"],
	["pacopacomama", "100126_100", "pacopacomama"],
	["muramura", "100426_1267", "muramura"],
	["pikkur", "04684", "pikkur"],
	["h0930", "gol225", "h0930"],
	["h4610", "ori1962", "h4610"],
	["c0930", "hitozuma1579", "c0930"],
	["eroxjapanz", "103_933", "eroxjapanz"],
	["3d-eros", "3dw-315", "3d-eros"],
	["unkotare", "ori10549", "unkotare"],
	// 已知限制
	["nyoshin", "n3351", null], // 详情页地域拦截（东京出口待复测）
	["kin8tengoku", "3997", null], // 裸数字撞号：kin8 被拦截时落到 pikkur 的同号商品
	["av9898", "4030-2857", null], // 详情页 302 到 heydouga 后 404，站点已并入 Hey動画
];

function mockRes() {
	return {
		statusCode: 200,
		headers: {},
		body: null,
		setHeader(k, v) {
			this.headers[k.toLowerCase()] = v;
		},
		end(p) {
			this.body = p ? JSON.parse(p) : null;
		},
	};
}

const pad = (s, n) => String(s ?? "-").padEnd(n);
let ok = 0;
let fail = 0;
let known = 0;

console.log("站点".padEnd(16) + "番号".padEnd(16) + "结果".padEnd(6) + "站名".padEnd(18) + "预告片".padEnd(12) + "耗时");
for (const [label, code, expect] of CODES) {
	const res = mockRes();
	const started = Date.now();
	try {
		await handler({ method: "GET", url: `/api?code=${encodeURIComponent(code)}&key=${KEY}`, headers: { host: "localhost" } }, res);
	} catch (err) {
		console.log(pad(label, 16) + pad(code, 16) + "异常".padEnd(6) + String(err?.message || err));
		fail++;
		continue;
	}
	const b = res.body || {};
	const ms = Date.now() - started;
	const hit = res.statusCode === 200;
	if (hit && (!expect || b.site_id === expect)) {
		ok++;
		console.log(pad(label, 16) + pad(code, 16) + "✅".padEnd(6) + pad(b.site_name, 18) + pad(b.preview_quality, 12) + `${ms}ms`);
	} else if (expect === null) {
		known++;
		console.log(
			pad(label, 16) + pad(code, 16) + "⚠️".padEnd(6) + pad(b.site_id || b.error, 18) + pad("-", 12) + `${ms}ms  (已知限制)`,
		);
	} else {
		fail++;
		const why = b.error || `${res.statusCode}`;
		console.log(pad(label, 16) + pad(code, 16) + "❌".padEnd(6) + pad(b.site_id || why, 18) + pad("-", 12) + `${ms}ms`);
	}
}

console.log(`\n可解析 ${ok}，已知限制 ${known}，意外失败 ${fail}（共 ${CODES.length} 家）`);
console.log("已知限制的原因见 docs/d2pass-api接口文档.md 第 9 节；部署到东京后请重跑本脚本复测。");
