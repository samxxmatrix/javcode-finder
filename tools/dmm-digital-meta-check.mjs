/**
 * 反代 **digital 通道**元数据的确定性检查（补齐 mono/faleno 之外的最后一条链路）。
 *
 * 背景：`searchDigital` 拿到的 `data` 会先被 handler 重组成 `detail` 字面量，
 * 再由此构造 `resultData` —— 2026-10-10 首次部署后生产冒烟发现该字面量**漏掉了三个新字段**，
 * digital 通道因此静默返回空元数据（mono / faleno 的本地检查抓不到）。本脚本专门盯这条路径。
 *
 * 全部桩掉（不发真实网络）：GraphQL 搜索 → 命中 id；GraphQL 详情 → 带 actresses / deliveryStartDate；
 * playlist 与 mp4 探测 → 404（走 probeFamilyPreview 的"保留原始 URL"分支）。
 *
 * 前置：advanced/dmm-api/vercel-dmm/node_modules 已安装
 * 用法：node tools/dmm-digital-meta-check.mjs
 */
import handler from "../advanced/dmm-api/vercel-dmm/api/index.js";
import { SCHEMA_VERSION } from "../advanced/dmm-api/vercel-dmm/lib/cache-entry.js";

const notFound = () => new Response("", { status: 404 });
const jsonResponse = (body, status = 200) =>
	new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json" },
	});

globalThis.fetch = async (url, init) => {
	const target = String(url);
	if (target.includes("api.video.dmm.co.jp/graphql")) {
		const body = typeof init?.body === "string" ? init.body : "";
		if (body.includes("legacySearchPPV")) {
			return jsonResponse({
				data: { legacySearchPPV: { result: { contents: [{ id: "1dldss00529" }] } } },
			});
		}
		if (body.includes("ppvContent")) {
			return jsonResponse({
				data: {
					ppvContent: {
						id: "1dldss00529",
						title: "電撃移籍 DAHLIA 小泉玖美41歳",
						description: "長い説明",
						packageImage: {
							largeUrl:
								"https://awsimgsrc.dmm.co.jp/pics_dig/digital/video/1dldss00529/1dldss00529pl.jpg",
						},
						// 2026-10-10 探针实测值（UTC → JST 即 2026-10-01）
						actresses: [{ id: "1108463", name: "小泉玖美" }],
						deliveryStartDate: "2026-09-30T15:00:00Z",
						sample2DMovie: {
							lowestMovieUrl: "https://cc3001.dmm.co.jp/pv/x/1dldss00529sm.mp4",
							highestMovieUrl: "https://cc3001.dmm.co.jp/pv/x/1dldss00529hhb.mp4",
							hlsMovieUrl: "https://cc3001.dmm.co.jp/pv/x/1dldss00529.m3u8",
						},
					},
				},
			});
		}
		return jsonResponse({ data: {} });
	}
	// playlist 与逐档 mp4 探测：一律 404 → probeFamilyPreview 保留原始 URL
	if (target.includes("dmm.co.jp")) return notFound();
	// 其它任何请求都不放行真实网络，保证本检查完全确定性
	return notFound();
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

console.log("=== digital 通道：元数据三个字段必须穿过 detail 重组 ===");
// 桩里的 id 与查询番号必须配对（pickCidFromList 会做归一化比对），否则会落到 mono 分支
const hit = await call({ code: "DLDSS-529" });
check("status", hit.status, 200);
check("channel", hit.body?.channel, "digital");
check("v", hit.body?.v, SCHEMA_VERSION);
check("actresses", JSON.stringify(hit.body?.actresses), JSON.stringify(["小泉玖美"]));
check("delivery_date（ISO 原样，JST 换算在扩展侧）", hit.body?.delivery_date, "2026-09-30T15:00:00Z");
check("sale_date（不用 saleStartDate）", hit.body?.sale_date, null);
check(
	"preview_url 保留原始档位（探测全 404 时不降档）",
	hit.body?.preview_url,
	"https://cc3001.dmm.co.jp/pv/x/1dldss00529hhb.mp4",
);

console.log(`\n${failed === 0 ? "全部 PASS" : `${failed} 项 FAIL`}`);
process.exitCode = failed === 0 ? 0 : 1;
