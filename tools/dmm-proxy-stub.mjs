/**
 * 反代全链路桩测：桩掉所有上游 fetch，跑真实 handler，断言选档 / 响应字段 / 错误分类。
 *
 * 用法：node tools/dmm-proxy-stub.mjs
 * 前置：advanced/dmm-api/vercel-dmm/node_modules 已安装（redis 依赖要被 index.js 解析到）
 *
 * Redis：进程内起一个假 Redis（tools/fake-redis.mjs）并把 REDIS_URL 指过去。
 * 不碰本机 Redis（空串会让 node-redis 回落到默认 127.0.0.1:6379，可能读到真实脏缓存）。
 *
 * 为什么必须真接一个可用的缓存后端：接入前 REDIS_URL 指向死端口，缓存层静默降级 ⇒ 一次缓存
 * 交互都不会发生，handler 的**接线**（读命中 / 写回 / 三处 setCached 的 cacheKey 守门 /
 * handleCidOnly 的 usableEntry 守卫）在本套件里完全不可见；纯函数单测只守得住
 * cacheKeyFrom / usableEntry 本身，删掉调用点的守卫两个套件都还是全绿。
 * 现在由 13-16 号用例断言这些接线：正对照（读和写真的发生）、脏键不读不写、
 * 版本不符重算、§14 键值不一致的脏条目被拒绝并覆盖。
 *
 * 17-20 号补五处缺口：17 探测总预算（PROBE_BUDGET_MS）耗尽后不再死等单档 5s 超时；
 * 18 FALENO 缓存接线（此前该通道在套件里完全不可见，写入点的 cacheKey 守卫删掉都没人喊）；
 * 19 Redis 不可达时静默降级（旧套件把 REDIS_URL 指死端口，假 Redis 上线后这条路径失去覆盖；
 *    端口改为 listen(0) 动态借 + 请求前实测拒连，写死端口被占用时不再静默假绿）；
 * 20 FALENO 上游 body 读取 reject 时必须回 500 JSON 错误响应（此前会逃出 handler，零响应）。
 *
 * 覆盖边界（别把假 Redis 当真实缓存）：只实现 handler 用到的 GET/SET + 连接期命令，
 * 没有 TTL / 淘汰 / 并发 / 持久化语义；未知命令回 -ERR 并记进命令日志（不静默）。
 */

import { isDeepStrictEqual } from "node:util";
import { readFileSync } from "node:fs";
import net from "node:net";
import handler from "../advanced/dmm-api/vercel-dmm/api/index.js";
import { SCHEMA_VERSION } from "../advanced/dmm-api/vercel-dmm/lib/cache-entry.js";
import { startFakeRedis } from "./fake-redis.mjs";

// core.autocrlf=true 且无 .gitattributes ⇒ 固件可能是 CRLF，先归一化，断言不依赖检出配置
const fixture = (name) =>
	readFileSync(new URL(`../test/fixtures/${name}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");

const PLAYLIST_8 = fixture("dmm-playlist-8tier.m3u8");
const PLAYLIST_6 = fixture("dmm-playlist-6tier.m3u8");
const PLAYLIST_W = fixture("dmm-playlist-wtier.m3u8");
const PLAYLIST_S = fixture("dmm-playlist-stier.m3u8");

const GQL = "https://api.video.dmm.co.jp/graphql";
const MP4_DIR = "https://cc3001.dmm.co.jp/pv/TOKEN/";
const HLS = "https://cc3001.dmm.co.jp/pv/HLSTOKEN/playlist.m3u8";
const MP4_BASE = `${MP4_DIR}h_1096bdsm091`;

process.env.API_KEY = "test-key";
process.env.PREVIEW_HEIGHT_MIN = "320";
process.env.PREVIEW_HEIGHT_MAX = "600";

// 假 Redis：handler 只在请求时读 REDIS_URL（import 时不读），所以在这里赋值就能生效。
// 起不来就直接抛 —— 缓存后端不可用会让 13-16 号用例全部退化，必须响亮地失败。
const redis = await startFakeRedis();
process.env.REDIS_URL = redis.url;

const realFetch = globalThis.fetch;

/**
 * URL 路由 → Response。
 * 匹配是「首个 includes 命中」⇒ 具体路由必须排在宽路由之前（HLS 要排在 /pv/ 之前、
 * 按档位的 mp4 路由要排在 /pv/ 目录路由之前），否则后面的条目永远轮不到。
 *
 * 未命中路由不会立刻暴露：handler 会把它当成「上游查不动」，降级成一个看似合理的 503/404，
 * 所以这里累加 unstubbed 计数，最后断言为 0（漏桩必须算进来，不能被误当业务断言通过）。
 *
 * 同时清空假 Redis 的键：每个用例的桩集不同 ⇒ 预期结果不同，残留缓存会让用例悄悄短路成
 * 「缓存命中」而不再走抓取路径（例：7c 写入 432p 后，7b 期望的 576p 永远拿不到）。
 * 缓存本身的存续由 13-16 号用例自己控制（它们不重设桩，只在需要时 seed/flush）。
 */
let unstubbed = 0;
/**
 * 本次用例真实发出的请求（每次 stub() 重置）：url + 是否带 AbortSignal。
 * 供两类断言用：① 没去抓假 URL（如 cid=null）；② 上游超时确实接在线上（signal 存在），
 * 否则删掉 AbortSignal.timeout 两个套件都看不见。
 */
let requests = [];
function stub(routes) {
	requests = [];
	redis.flush();
	globalThis.fetch = async (url, init) => {
		const target = String(url);
		requests.push({ url: target, hasSignal: typeof init?.signal === "object" && init?.signal !== null });
		for (const [match, reply] of routes) {
			if (target.includes(match)) return reply(target, init);
		}
		unstubbed += 1;
		return new Response("unstubbed: " + target, { status: 500 });
	};
}

const json = (body, status = 200) =>
	new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const text = (body, status = 200) => new Response(body, { status });

/**
 * 「HTTP 200，但读 body 时 reject」的上游应答（模拟响应流中断）。
 * 用真 Response 保证 status/ok 语义真实，只在实例上盖掉 text()。
 * 20 号用例拿它盖 FALENO 的 body 读取分支：该分支此前在 try 之外，且 dispatch 没有 await，
 * reject 会一路逃出 handler —— 客户端一个响应都拿不到。
 */
function rejectingTextResponse(message = "stream terminated") {
	const response = new Response("", { status: 200 });
	Object.defineProperty(response, "text", {
		value: () => Promise.reject(new Error(message)),
	});
	return response;
}

/**
 * 「永不回包、但尊重 init.signal」的应答：只有 abort 才 reject（模拟真实 fetch 的超时语义）。
 * 17 号用例拿它当首档上游 —— 预算没生效时它会一直挂着；所以没有 signal 就直接 reject，
 * 让回归响亮失败（抛错/断言红），而不是把整条用例挂死到看不出原因。
 */
function hangUntilAbort() {
	return (target, init) => new Promise((_, reject) => {
		const fail = () => reject(Object.assign(new Error("timeout"), { name: "TimeoutError" }));
		const signal = init?.signal;
		if (typeof signal?.addEventListener !== "function") {
			reject(new Error(`probe fetch without AbortSignal: ${target}`));
			return;
		}
		if (signal.aborted) fail();
		else signal.addEventListener("abort", fail);
	});
}

/**
 * 标准"数字版命中"路由：搜索 → 详情 → playlist → 各档 mp4 存在。
 * lowest/highest 决定 mp4 目录与文件名主体（档位由 playlist 的 token 拼出）。
 */
function digitalRoutes({
	playlist = PLAYLIST_8,
	search = "h_1096bdsm00091",
	cid = "h_1096bdsm00091",
	hls = HLS,
	lowest = `${MP4_BASE}sm.mp4`,
	highest = `${MP4_BASE}hhbs.mp4`,
	image = "https://awsimgsrc.dmm.co.jp/x.jpg",
} = {}) {
	return [
		[GQL, (target, init) => {
			const query = String(init?.body ?? "");
			if (query.includes("legacySearchPPV")) {
				return json({ data: { legacySearchPPV: { result: { contents: [{ id: search }] } } } });
			}
			return json({
				data: {
					ppvContent: {
						id: cid,
						title: "短标题",
						description: "长标题",
						packageImage: { largeUrl: image },
						sample2DMovie: { lowestMovieUrl: lowest, highestMovieUrl: highest, hlsMovieUrl: hls },
					},
				},
			});
		}],
		[HLS, () => text(playlist)],
		// 探测判定是「206 或 200 且 Content-Type 为 video/*」（设计 §6），所以成功桩必须带 video/mp4
		["/pv/", () => new Response("", { status: 200, headers: { "content-type": "video/mp4" } })],
	];
}

let failed = 0;
let assertions = 0;
function check(label, actual, expected) {
	assertions += 1;
	const ok = isDeepStrictEqual(actual, expected);
	if (!ok) failed += 1;
	console.log(`${ok ? "PASS" : "FAIL"}  ${label}: ${JSON.stringify(actual)}${ok ? "" : ` (期望 ${JSON.stringify(expected)})`}`);
}

async function call(query) {
	const result = { status: null, body: null, headers: {} };
	const res = {
		setHeader(name, value) {
			result.headers[name.toLowerCase()] = value;
		},
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

/**
 * 借一个「此刻空闲」的 TCP 端口：listen(0) 让内核分配，读到端口号后立刻关掉。
 * 19 号用例专用 —— 见那里注释：固定死端口可能被占用，降级路径就不再被覆盖。
 */
function freePort() {
	return new Promise((resolve, reject) => {
		const server = net.createServer();
		server.once("error", reject);
		server.listen(0, "127.0.0.1", () => {
			const { port } = server.address();
			server.close(() => resolve(port));
		});
	});
}

/**
 * TCP 探活：只有 ECONNREFUSED（确实没人监听）才返回 true。
 * 连上了（有人监听）或任何其他错误一律返回 false ⇒ 调用点的 check 变红，用例不允许静默通过。
 */
function probeRefused(port) {
	return new Promise((resolve) => {
		const socket = net.connect({ port, host: "127.0.0.1" });
		const settle = (value) => {
			socket.destroy();
			resolve(value);
		};
		socket.once("connect", () => settle(false));
		socket.once("error", (err) => settle(err.code === "ECONNREFUSED"));
	});
}

const tail = (url) => String(url ?? "").split("/").pop();

try {
	console.log("=== 1) 8 档主家族 → 默认落到 mmb(432p) ===");
	stub(digitalRoutes());
	const hit = await call({ code: "BDSM-091", key: "test-key" });
	check("status", hit.status, 200);
	check("preview_url 档位", tail(hit.body?.preview_url), "h_1096bdsm091mmb.mp4");
	check("preview_url 完整（目录取 mp4 而非 m3u8）", hit.body?.preview_url, MP4_DIR + "h_1096bdsm091mmb.mp4");
	check("preview_quality", hit.body?.preview_quality, "432p");
	check("preview_qualities 档数", hit.body?.preview_qualities?.length, 8);
	check("preview_qualities[0] 形状", hit.body?.preview_qualities?.[0]?.quality, "144p");
	check("preview_qualities[0].url", hit.body?.preview_qualities?.[0]?.url, MP4_DIR + "h_1096bdsm091sm.mp4");
	check("preview_qualities[2] 分辨率 768x432", hit.body?.preview_qualities?.[2]?.resolution, "768x432");
	check("条目版本 v", hit.body?.v, SCHEMA_VERSION);
	check("cached", hit.body?.cached, false);

	console.log("\n=== 2) ?quality=1080p 覆盖（两个 1080 取更轻）===");
	const q1080 = await call({ code: "BDSM-091", key: "test-key", quality: "1080p" });
	check("preview_url 档位", tail(q1080.body?.preview_url), "h_1096bdsm091hhb.mp4");
	check("preview_quality", q1080.body?.preview_quality, "1080p");
	check("quality 回显", q1080.body?.quality, 1080);

	console.log("\n=== 2b) 非法 ?quality=1080（无 p 后缀）→ 忽略覆盖，仍落 mmb(432p) ===");
	const qBad = await call({ code: "BDSM-091", key: "test-key", quality: "1080" });
	check("preview_quality（非法覆盖被忽略）", qBad.body?.preview_quality, "432p");

	console.log("\n=== 3) 数字版家族（_w，无 RESOLUTION）→ dmb_w(404p) ===");
	stub(digitalRoutes({
		playlist: PLAYLIST_W,
		search: "ipx00118",
		cid: "ipx00118",
		lowest: `${MP4_DIR}ipx00118_sm_w.mp4`,
		highest: `${MP4_DIR}ipx00118_dmb_w.mp4`,
	}));
	const wTier = await call({ code: "IPX-118", key: "test-key" });
	check("preview_url 档位", tail(wTier.body?.preview_url), "ipx00118_dmb_w.mp4");
	check("preview_url 完整", wTier.body?.preview_url, MP4_DIR + "ipx00118_dmb_w.mp4");
	check("preview_quality", wTier.body?.preview_quality, "404p");

	console.log("\n=== 3b) 6 档主家族（无 s 兄弟）→ mmb(432p) ===");
	stub(digitalRoutes({
		playlist: PLAYLIST_6,
		search: "41hodv22112",
		cid: "41hodv22112",
		lowest: `${MP4_DIR}41hodv22112sm.mp4`,
		highest: `${MP4_DIR}41hodv22112hhb.mp4`,
	}));
	const sixTier = await call({ code: "HODV-22112", key: "test-key" });
	check("preview_url 档位", tail(sixTier.body?.preview_url), "41hodv22112mmb.mp4");
	check("preview_quality", sixTier.body?.preview_quality, "432p");

	console.log("\n=== 3c) 数字版家族（_s，无 RESOLUTION）→ dmb_s(404p) ===");
	stub(digitalRoutes({
		playlist: PLAYLIST_S,
		search: "iptd00700",
		cid: "iptd00700",
		lowest: `${MP4_DIR}iptd00700_sm_s.mp4`,
		highest: `${MP4_DIR}iptd00700_dmb_s.mp4`,
	}));
	const sTier = await call({ code: "IPTD-700", key: "test-key" });
	check("preview_url 档位", tail(sTier.body?.preview_url), "iptd00700_dmb_s.mp4");
	check("preview_quality", sTier.body?.preview_quality, "404p");

	console.log("\n=== 4) 两路都确认查无 → 404 ITEM_NOT_FOUND ===");
	stub([
		[GQL, () => json({ data: { legacySearchPPV: { result: { contents: [] } } } })],
		["dmm.co.jp/mono/-/search", () => new Response("", { status: 404 })],
		["/age_check/", () => new Response("", { status: 200 })],
	]);
	const nf = await call({ code: "ZZZ-999", key: "test-key" });
	check("status", nf.status, 404);
	check("error", nf.body?.error, "ITEM_NOT_FOUND");
	check("404 无 Retry-After", nf.headers["retry-after"], undefined);

	console.log("\n=== 5) 上游抛错 → 503 SOURCE_UNAVAILABLE + Retry-After ===");
	stub([[GQL, () => { throw new Error("boom"); }], ["dmm.co.jp", () => { throw new Error("boom"); }]]);
	const boom = await call({ code: "ZZZ-999", key: "test-key" });
	check("status", boom.status, 503);
	check("error", boom.body?.error, "SOURCE_UNAVAILABLE");
	check("code", boom.body?.code, 50301);
	check("Retry-After", boom.headers["retry-after"], "5");

	console.log("\n=== 6) 搜索查无 + mono 搜索页 500 → 503（不能因为另一路查无就断言不存在）===");
	stub([
		[GQL, () => json({ data: { legacySearchPPV: { result: { contents: [] } } } })],
		["dmm.co.jp/mono/-/search", () => new Response("", { status: 500 })],
		["/age_check/", () => new Response("", { status: 200 })],
	]);
	const mono500 = await call({ code: "ZZZ-998", key: "test-key" });
	check("status", mono500.status, 503);
	check("error", mono500.body?.error, "SOURCE_UNAVAILABLE");
	check("Retry-After", mono500.headers["retry-after"], "5");

	console.log("\n=== 7) playlist 拉取失败 → 模板探测路径（命中 mmb）===");
	const probeRoutes = digitalRoutes();
	stub(probeRoutes.map(([match, reply]) => (match === HLS ? [HLS, () => new Response("", { status: 500 })] : [match, reply])));
	const probed = await call({ code: "BDSM-091", key: "test-key" });
	check("status", probed.status, 200);
	check("preview_url 档位", tail(probed.body?.preview_url), "h_1096bdsm091mmb.mp4");
	check("preview_quality", probed.body?.preview_quality, "432p");

	console.log("\n=== 7b) playlist 失败 + mmb 缺档、mhb 在 → 探测命中 mhb(576p) ===");
	stub([
		digitalRoutes()[0], // GQL：搜索命中 + 详情里带 8 档 playlist 的 mp4 目录
		[HLS, () => new Response("", { status: 500 })],
		[`${MP4_BASE}mmb.mp4`, () => new Response("", { status: 404 })],
		[`${MP4_BASE}mhb.mp4`, () => new Response("", { status: 206, headers: { "content-type": "video/mp4" } })],
		[MP4_DIR, () => new Response("", { status: 404 })],
	]);
	const probed576 = await call({ code: "BDSM-091", key: "test-key" });
	check("status", probed576.status, 200);
	check("preview_url 档位", tail(probed576.body?.preview_url), "h_1096bdsm091mhb.mp4");
	check("preview_quality", probed576.body?.preview_quality, "576p");

	console.log("\n=== 7c) 全档探测失败 → 200 但保留 API 最高档，quality 未知、档位表为空 ===");
	stub([
		digitalRoutes()[0], // GQL：搜索命中 + 详情里带 8 档 playlist 的 mp4 目录
		[HLS, () => new Response("", { status: 500 })],
		[MP4_DIR, () => new Response("", { status: 404 })],
	]);
	const probeFail = await call({ code: "BDSM-091", key: "test-key" });
	check("status", probeFail.status, 200);
	check("preview_url 保留最高档", probeFail.body?.preview_url, MP4_DIR + "h_1096bdsm091hhbs.mp4");
	check("preview_quality", probeFail.body?.preview_quality, null);
	check("preview_qualities", probeFail.body?.preview_qualities, []);

	console.log("\n=== 7d) 探测：200 但 content-type 不是 video/* → 必须跳过该档 ===");
	stub([
		digitalRoutes()[0], // GQL：搜索命中 + 详情里带 8 档 playlist 的 mp4 目录
		[HLS, () => new Response("", { status: 500 })],
		[`${MP4_BASE}mmb.mp4`, () => new Response("not a video", { status: 200, headers: { "content-type": "text/html" } })],
		[`${MP4_BASE}mhb.mp4`, () => new Response("", { status: 200, headers: { "content-type": "video/mp4" } })],
		[MP4_DIR, () => new Response("", { status: 404 })],
	]);
	const ctSkip = await call({ code: "BDSM-091", key: "test-key" });
	check("preview_url 档位（跳过 200+text/html）", tail(ctSkip.body?.preview_url), "h_1096bdsm091mhb.mp4");
	check("preview_quality", ctSkip.body?.preview_quality, "576p");

	console.log("\n=== 7e) 探测：首档 fetch 抛错 → 继续下一档并命中 ===");
	stub([
		digitalRoutes()[0], // GQL：搜索命中 + 详情里带 8 档 playlist 的 mp4 目录
		[HLS, () => new Response("", { status: 500 })],
		[`${MP4_BASE}mmb.mp4`, () => { throw new Error("probe boom"); }],
		[`${MP4_BASE}mhb.mp4`, () => new Response("", { status: 206, headers: { "content-type": "video/mp4" } })],
		[MP4_DIR, () => new Response("", { status: 404 })],
	]);
	const probeThrow = await call({ code: "BDSM-091", key: "test-key" });
	check("status", probeThrow.status, 200);
	check("preview_url 档位（首档抛错后被跳过）", tail(probeThrow.body?.preview_url), "h_1096bdsm091mhb.mp4");
	check("preview_quality", probeThrow.body?.preview_quality, "576p");

	console.log("\n=== 8) mono 详情页命中年龄确认页 → 503（接入前会被误判成查无）===");
	stub([
		[GQL, () => json({ data: { legacySearchPPV: { result: { contents: [] } } } })],
		["dmm.co.jp/mono/-/search", () => text('<div class="card"><a href="/mono/dvd/-/detail/=/cid=1abc00123/">x</a></div>')],
		["/age_check/", () => new Response("", { status: 200 })],
		["dmm.co.jp/mono/dvd/-/detail", () => text("<html>年齢認証</html>")],
	]);
	const blocked = await call({ code: "ABC-123", key: "test-key" });
	check("status", blocked.status, 503);
	check("error", blocked.body?.error, "SOURCE_UNAVAILABLE");
	check("Retry-After", blocked.headers["retry-after"], "5");

	console.log("\n=== 9) mono 详情页空壳 → 404 确认查无 ===");
	stub([
		[GQL, () => json({ data: { legacySearchPPV: { result: { contents: [] } } } })],
		["dmm.co.jp/mono/-/search", () => text('<div class="card"><a href="/mono/dvd/-/detail/=/cid=1abc00123/">x</a></div>')],
		["/age_check/", () => new Response("", { status: 200 })],
		["dmm.co.jp/mono/dvd/-/detail", () => text("<html><body>Not Found</body></html>")],
	]);
	const shell = await call({ code: "ABC-123", key: "test-key" });
	check("status", shell.status, 404);
	check("error", shell.body?.error, "ITEM_NOT_FOUND");
	check("404 无 Retry-After", shell.headers["retry-after"], undefined);

	console.log("\n=== 10) 脏番号仍能查、响应 code 回退为原文大写（键卫生由纯函数单测守住）===");
	stub(digitalRoutes({
		search: "mfyd00189",
		cid: "mfyd00189",
		lowest: `${MP4_DIR}mfyd00189sm.mp4`,
		highest: `${MP4_DIR}mfyd00189hhb.mp4`,
	}));
	const dirty = await call({ code: "任务名称:-MFYD-189", key: "test-key" });
	check("status", dirty.status, 200);
	check("cid", dirty.body?.cid, "mfyd00189");
	check("code 回退为原文大写", dirty.body?.code, "任务名称:-MFYD-189");

	console.log("\n=== 11a) GraphQL 详情返回 errors（无 ppvContent）→ 503 SOURCE_UNAVAILABLE ===");
	stub([
		[GQL, (target, init) => {
			const query = String(init?.body ?? "");
			if (query.includes("legacySearchPPV")) {
				return json({ data: { legacySearchPPV: { result: { contents: [{ id: "h_1096bdsm00091" }] } } } });
			}
			return json({ errors: [{ message: "boom" }] });
		}],
		["dmm.co.jp/mono/-/search", () => new Response("", { status: 404 })],
		["/age_check/", () => new Response("", { status: 200 })],
	]);
	const gqlErrors = await call({ code: "BDSM-091", key: "test-key" });
	check("status", gqlErrors.status, 503);
	check("error", gqlErrors.body?.error, "SOURCE_UNAVAILABLE");
	check("code", gqlErrors.body?.code, 50301);
	check("Retry-After", gqlErrors.headers["retry-after"], "5");

	console.log("\n=== 11b) GraphQL 详情 ppvContent=null 且无 errors → 404 确认查无 ===");
	stub([
		[GQL, (target, init) => String(init?.body ?? "").includes("legacySearchPPV")
			? json({ data: { legacySearchPPV: { result: { contents: [{ id: "h_1096bdsm00091" }] } } } })
			: json({ data: { ppvContent: null } })],
		["dmm.co.jp/mono/-/search", () => new Response("", { status: 404 })],
		["/age_check/", () => new Response("", { status: 200 })],
	]);
	const gqlNull = await call({ code: "BDSM-091", key: "test-key" });
	check("status", gqlNull.status, 404);
	check("error", gqlNull.body?.error, "ITEM_NOT_FOUND");

	console.log("\n=== 11c) GraphQL 搜索非 2xx → 503 SOURCE_UNAVAILABLE ===");
	stub([
		[GQL, () => json({}, 500)],
		["dmm.co.jp/mono/-/search", () => new Response("", { status: 404 })],
		["/age_check/", () => new Response("", { status: 200 })],
	]);
	const gql500 = await call({ code: "BDSM-091", key: "test-key" });
	check("status", gql500.status, 503);
	check("error", gql500.body?.error, "SOURCE_UNAVAILABLE");

	console.log("\n=== 11d) GraphQL 搜索空 + mono 搜索页被年龄确认拦截 → 503 ===");
	stub([
		[GQL, () => json({ data: { legacySearchPPV: { result: { contents: [] } } } })],
		["dmm.co.jp/mono/-/search", () => text("<html>年齢認証</html>")],
		["/age_check/", () => new Response("", { status: 200 })],
	]);
	const blockedSearch = await call({ code: "ABC-123", key: "test-key" });
	check("status", blockedSearch.status, 503);
	check("error", blockedSearch.body?.error, "SOURCE_UNAVAILABLE");

	console.log("\n=== 11e) mono 命中：搜索页 → 详情页 → 同目录探测（整段 mono 组装）===");
	stub([
		[GQL, () => json({ data: { legacySearchPPV: { result: { contents: [] } } } })],
		["dmm.co.jp/mono/-/search", () => text('<div class="card"><a href="/mono/dvd/-/detail/=/cid=1abc00123/">x</a></div>')],
		["/age_check/", () => new Response("", { status: 200 })],
		["dmm.co.jp/mono/dvd/-/detail", () => text(
			'<html><head>'
			+ '<meta property="og:title" content="短标题">'
			+ '<meta property="og:image" content="https://pics.dmm.co.jp/mono/movie/adult/1abc00123/1abc00123pl.jpg">'
			+ '<meta property="og:description" content="长标题">'
			+ "</head><body>"
			+ `${MP4_DIR}h_1096bdsm091hhbs.mp4`
			+ "</body></html>"
		)],
		[MP4_DIR, () => new Response("", { status: 200, headers: { "content-type": "video/mp4" } })],
	]);
	const monoHit = await call({ code: "ABC-123", key: "test-key" });
	check("status", monoHit.status, 200);
	check("channel", monoHit.body?.channel, "mono");
	check("preview_url 档位（探测命中 mmb）", tail(monoHit.body?.preview_url), "h_1096bdsm091mmb.mp4");
	check("preview_quality", monoHit.body?.preview_quality, "432p");
	// 注意：只查 signal 是否存在，不真的等超时触发（否则每次跑要多花 6-8s）
	const monoFetches = requests.filter((r) => r.url.includes("dmm.co.jp/mono/"));
	check("mono 搜索页/详情页请求都带 AbortSignal", monoFetches.length >= 2 && monoFetches.every((r) => r.hasSignal), true);

	console.log("\n=== 12) mono 搜索页 200 但没有候选 → 404（不得去抓 cid=null）===");
	stub([
		[GQL, () => json({ data: { legacySearchPPV: { result: { contents: [] } } } })],
		["dmm.co.jp/mono/-/search", () => text("<html><body>no candidates here</body></html>")],
		["/age_check/", () => new Response("", { status: 200 })],
		// 陷阱桩：假 URL 若真被请求，这里会回 200 + og:title 让 buggy 路径答 200（正常路径根本走不到这里）
		["dmm.co.jp/mono/dvd/-/detail", () => text(
			'<html><head>'
			+ '<meta property="og:title" content="短标题">'
			+ '<meta property="og:image" content="https://pics.dmm.co.jp/mono/movie/adult/1abc00123/1abc00123pl.jpg">'
			+ "</head><body>"
			+ `${MP4_DIR}h_1096bdsm091hhbs.mp4`
			+ "</body></html>"
		)],
		[MP4_DIR, () => new Response("", { status: 200, headers: { "content-type": "video/mp4" } })],
	]);
	const noCandidate = await call({ code: "QQQ-001", key: "test-key" });
	check("status", noCandidate.status, 404);
	check("error", noCandidate.body?.error, "ITEM_NOT_FOUND");
	check("未请求 cid=null 详情页", requests.some((r) => r.url.includes("cid=null")), false);

	console.log("\n=== 13) 缓存命中与写入（正对照）===");
	// 正对照：先证明「读和写都真的发生过」，下面三个阴性用例（脏键 0 命令 / 版本不符 /
	// 脏条目）才有意义 —— 否则把三处 cacheKey 守卫和 usableEntry 全删掉也一样是 0 命令，阴性用例假绿。
	stub(digitalRoutes());
	redis.commands.length = 0;
	const firstWrite = await call({ code: "BDSM-091", key: "test-key" });
	check("status", firstWrite.status, 200);
	check("cached（首次请求：未命中但写回）", firstWrite.body?.cached, false);
	check("假 Redis 收到 BDSM-091 的 SET",
		redis.commands.some((c) => c.name === "SET" && c.args[0] === "BDSM-091"), true);
	// 同一个键再请求一次：这一次必须直接吃缓存，且答案与首答逐字一致
	const secondRead = await call({ code: "BDSM-091", key: "test-key" });
	check("cached（二次请求：读命中）", secondRead.body?.cached, true);
	check("假 Redis 收到 BDSM-091 的 GET",
		redis.commands.some((c) => c.name === "GET" && c.args[0] === "BDSM-091"), true);
	check("命中响应的 preview_quality 与首答一致", secondRead.body?.preview_quality, firstWrite.body?.preview_quality);
	check("命中响应的 preview_url 与首答一致", secondRead.body?.preview_url, firstWrite.body?.preview_url);

	console.log("\n=== 14) 脏键不读不写（cacheKeyFrom 返回 null ⇒ 0 次缓存交互）===");
	// 桩同 10 号用例：脏番号仍能查到 mfyd00189，但它的键不合法 ⇒ 既不读也不写。
	// 这条专打 index.js:212 的 if (cacheKey) 守卫：删掉守卫后 setCached(null, ...) 会先建连
	// （连接期就有 CLIENT SETINFO 两条命令），命令数立刻不为 0 ⇒ 红。
	stub(digitalRoutes({
		search: "mfyd00189",
		cid: "mfyd00189",
		lowest: `${MP4_DIR}mfyd00189sm.mp4`,
		highest: `${MP4_DIR}mfyd00189hhb.mp4`,
	}));
	redis.commands.length = 0;
	const dirtyNoCache = await call({ code: "任务名称:-MFYD-189", key: "test-key" });
	check("status", dirtyNoCache.status, 200);
	check("cid", dirtyNoCache.body?.cid, "mfyd00189");
	check("脏键请求期间的 Redis 命令数", redis.commands.length, 0);
	check("脏键请求没有写入任何键", redis.entries.size, 0);
	// index.js:261（handleCidOnly 写 CID: 键）是另一个独立的守卫点：上面走的是全量路径的 :212。
	// 同一个脏番号再打一次 only=cid，两条路径都必须交出 0 命令，三处 setCached 守卫才各自被钉住。
	const dirtyCidOnly = await call({ code: "任务名称:-MFYD-189", key: "test-key", only: "cid" });
	check("脏键 only=cid 请求的 status", dirtyCidOnly.status, 200);
	check("脏键 only=cid 请求的 cid", dirtyCidOnly.body?.cid, "mfyd00189");
	check("脏键 only=cid 请求期间的 Redis 命令数", redis.commands.length, 0);
	// 对照：同一套桩下换干净键必须真的有缓存交互，否则上面的 0 可能只是「缓存整体没接线」
	stub(digitalRoutes());
	redis.commands.length = 0;
	const cleanControl = await call({ code: "BDSM-091", key: "test-key" });
	check("对照：干净键请求期间的 Redis 命令数 ≥1", cleanControl.status === 200 && redis.commands.length >= 1, true);

	console.log("\n=== 15) 版本不符 → 未命中重算并覆盖 ===");
	// 历史条目（本次变更前写入的，没有 v 字段）：usableEntry 必须当未命中，重算后整键覆盖
	stub(digitalRoutes());
	redis.seed({ "BDSM-091": { code: "BDSM-091", cid: "stale-cid", channel: "digital" } });
	redis.commands.length = 0;
	const staleEntry = await call({ code: "BDSM-091", key: "test-key" });
	check("status", staleEntry.status, 200);
	check("cached（版本不符 ⇒ 未命中）", staleEntry.body?.cached, false);
	check("cid（不采用历史条目的 cid）", staleEntry.body?.cid, "h_1096bdsm00091");
	check("cid 不是 stale-cid", staleEntry.body?.cid !== "stale-cid", true);
	check("重算后覆盖写入且带 v", redis.json("BDSM-091")?.v, SCHEMA_VERSION);
	check("覆盖写入条目的 code", redis.json("BDSM-091")?.code, "BDSM-091");

	console.log("\n=== 16) 键值不一致的脏条目 → 拒绝并重算（§14 回归）===");
	// 历史污染条目：CID:IPTD-700 里装的是 NHDTB-700 的数据（本次变更集要修的原始 bug）。
	// handleCidOnly 的 CID: 分支若不走 usableEntry，就会把 1nhdtb00700 当成 IPTD-700 的答案吐出去。
	stub(digitalRoutes({
		search: "iptd00700",
		cid: "iptd00700",
		lowest: `${MP4_DIR}iptd00700_sm_s.mp4`,
		highest: `${MP4_DIR}iptd00700_dmb_s.mp4`,
	}));
	redis.seed({ "CID:IPTD-700": { v: SCHEMA_VERSION, code: "NHDTB-700", cid: "1nhdtb00700", channel: "digital" } });
	redis.commands.length = 0;
	const poisoned = await call({ code: "IPTD-700", key: "test-key", only: "cid" });
	check("status", poisoned.status, 200);
	check("cid（拒绝脏条目的 cid）", poisoned.body?.cid, "iptd00700");
	check("cached（脏条目不算命中）", poisoned.body?.cached, false);
	check("CID:IPTD-700 已被合规条目覆盖（code）", redis.json("CID:IPTD-700")?.code, "IPTD-700");
	check("CID:IPTD-700 已被合规条目覆盖（cid）", redis.json("CID:IPTD-700")?.cid, "iptd00700");

	console.log("\n=== 17) 探测总预算（PROBE_BUDGET_MS）耗尽 → 走兜底，不等 5s 单档超时 ===");
	// 打的是 M18：playlist 挂掉后 7 个候选各等 TIMEOUT.playlist(5s) ⇒ 最坏 35s，函数会把预算
	// 全花在没人等的请求上。首档 mmb 永不回包（只认 abort），而 mhb 就在后面等着：预算若是
	// 没生效，5s 后 mmb 超时、接着命中 mhb(576p)，值断言与耗时断言同时红。
	// 预算在 probeFamilyPreview 内部读 ⇒ 这里可以只给本用例改（前后保存/恢复）。
	const savedProbeBudget = process.env.PROBE_BUDGET_MS;
	process.env.PROBE_BUDGET_MS = "300";
	stub([
		digitalRoutes()[0], // GQL：搜索命中 + 详情带 mp4 目录（highest = hhbs）
		[HLS, () => new Response("", { status: 500 })],
		[`${MP4_BASE}mmb.mp4`, hangUntilAbort()],
		[`${MP4_BASE}mhb.mp4`, () => new Response("", { status: 206, headers: { "content-type": "video/mp4" } })],
		[MP4_DIR, () => new Response("", { status: 404 })],
	]);
	const budgetStart = Date.now();
	const budgetBail = await call({ code: "BDSM-091", key: "test-key" });
	const budgetElapsed = Date.now() - budgetStart;
	if (savedProbeBudget === undefined) delete process.env.PROBE_BUDGET_MS;
	else process.env.PROBE_BUDGET_MS = savedProbeBudget;
	check("status", budgetBail.status, 200);
	check("preview_url 保留最高档（预算耗尽不降画质）", budgetBail.body?.preview_url, MP4_DIR + "h_1096bdsm091hhbs.mp4");
	check("preview_quality", budgetBail.body?.preview_quality, null);
	check("preview_qualities", budgetBail.body?.preview_qualities, []);
	check("耗时 < 2s（回退到 5s 单档超时即红）", budgetElapsed < 2000, true);

	console.log("\n=== 18) FALENO 缓存接线：干净键写入/读命中、历史条目重算、脏键不读不写 ===");
	// FALENO 此前在套件里完全没有用例，写入点的接线（含 index.js:337 的 if (cacheKey) 守卫）
	// 删掉也没人喊。前四条断言证明「写和读真的发生」；最后一条（脏键 0 命令）才是钉住守卫的。
	stub([["faleno.jp/top/works/", () => text(fixture("FNS263.html"))]]);
	redis.commands.length = 0;
	redis.flush();
	const falenoFirst = await call({ code: "FNS-263", key: "test-key", only: "faleno" });
	check("status", falenoFirst.status, 200);
	check("channel", falenoFirst.body?.channel, "faleno");
	check("条目版本 v", falenoFirst.body?.v, SCHEMA_VERSION);
	check("cached（首次请求：未命中但写回）", falenoFirst.body?.cached, false);
	check("假 Redis 收到 FALENO:FNS-263 的 SET",
		redis.commands.some((c) => c.name === "SET" && c.args[0] === "FALENO:FNS-263"), true);
	check("写入条目的 code（canonical，不带 FALENO: 前缀）", redis.json("FALENO:FNS-263")?.code, "FNS-263");
	check("写入条目的 channel", redis.json("FALENO:FNS-263")?.channel, "faleno");
	check("写入条目的 preview_url（真实固件解析结果）",
		redis.json("FALENO:FNS-263")?.preview_url,
		"https://cdn.faleno.net/top/wp-content/uploads/2026/09/FNS-263_PR.mp4");
	// 同一个键再请求一次：必须直接吃缓存
	const falenoSecond = await call({ code: "FNS-263", key: "test-key", only: "faleno" });
	check("cached（二次请求：读命中）", falenoSecond.body?.cached, true);
	check("命中响应的 cid 与首答一致", falenoSecond.body?.cid, falenoFirst.body?.cid);
	// 历史条目（无 v 字段）：usableEntry 当未命中，重抓后整键覆盖
	redis.seed({ "FALENO:FNS-263": { code: "FNS-263", cid: "fns263", channel: "faleno", title: "历史条目" } });
	const falenoStale = await call({ code: "FNS-263", key: "test-key", only: "faleno" });
	check("cached（版本不符 ⇒ 未命中）", falenoStale.body?.cached, false);
	check("重算后覆盖写入且带 v", redis.json("FALENO:FNS-263")?.v, SCHEMA_VERSION);
	// 脏键（canonical 为空）：既不读也不写。删掉写入点的守卫后，setCached(null, ...) 仅建连
	// 就会发两条 CLIENT SETINFO ⇒ 命令数立刻不为 0，所以下面这条是杀死该突变体的断言。
	redis.commands.length = 0;
	const falenoDirty = await call({ code: "任务名称:-FNS-263", key: "test-key", only: "faleno" });
	check("脏键 status", falenoDirty.status, 200);
	check("脏键 channel", falenoDirty.body?.channel, "faleno");
	check("脏键请求期间的 Redis 命令数（写入点守卫）", redis.commands.length, 0);

	console.log("\n=== 19) Redis 不可达 → 静默降级（200 + 正确档位 + cached:false）===");
	// 接入前 REDIS_URL 指向死端口，这条路径每个请求都走到；现在假 Redis 总是活的，必须显式
	// 打回死端口才能重新盖住它。拒连在 ~100ms 内返回（get/set 各一次），不会拖慢套件。
	// 端口必须动态选：写死的端口（原来写死 6398）一旦被别的进程占着，Redis 其实连得上 ⇒ 降级
	// 路径一步都没走，用例静默假绿（实测：有人在 6398 另起一个 RESP 服务，128 条断言照样全绿，
	// handler 还往那个外来服务里写了缓存条目）。所以先 listen(0) 借一个当下空闲的端口，再在
	// 发起请求前实测「拒连」：只有确认 ECONNREFUSED 才让本用例继续，否则下面那条 check 直接红。
	stub(digitalRoutes());
	const deadPort = await freePort();
	const liveRedisUrl = process.env.REDIS_URL;
	process.env.REDIS_URL = `redis://127.0.0.1:${deadPort}`;
	// 前置条件：此刻必须真的没人监听它。连上了（或探测报出别的错）= 用例前提不成立 ⇒ 红，
	// 绝不静默变成「Redis 可用」的假绿。
	check(`前置：${deadPort} 端口此刻拒连（ECONNREFUSED）`, await probeRefused(deadPort), true);
	redis.commands.length = 0;
	let degraded;
	try {
		degraded = await call({ code: "BDSM-091", key: "test-key" });
	} finally {
		process.env.REDIS_URL = liveRedisUrl;
	}
	check("status（Redis 挂了也要答对）", degraded.status, 200);
	check("preview_quality", degraded.body?.preview_quality, "432p");
	check("cached（读不到也没写进去）", degraded.body?.cached, false);
	check("Redis 不可达期间假 Redis 0 命令", redis.commands.length, 0);
	// 恢复：写回照常发生、读命中照常命中 —— 降级没有留下"缓存失效"的副作用
	const recoveredWrite = await call({ code: "BDSM-091", key: "test-key" });
	check("恢复后 status", recoveredWrite.status, 200);
	check("恢复后 cached（未命中但写回）", recoveredWrite.body?.cached, false);
	check("恢复后假 Redis 收到 BDSM-091 的 SET",
		redis.commands.some((c) => c.name === "SET" && c.args[0] === "BDSM-091"), true);
	const recoveredHit = await call({ code: "BDSM-091", key: "test-key" });
	check("恢复后二次请求 cached（读命中）", recoveredHit.body?.cached, true);

	console.log("\n=== 20) FALENO 上游 body 读取 reject → 仍然回 500 JSON（不能连响应都没有）===");
	// 打的是 FALENO 路径上的两个洞：`const html = await upstream.text()` 此前不在任何 try 里，
	// 且 dispatcher 用的是 `return handleFaleno(...)`（没有 await）⇒ 这个 rejection 连 handler
	// 的外层 catch 都观察不到：实测结果是 handler 的 promise 直接 reject，一个响应都发不出去
	// （Vercel 只能给平台错误页）。修复后 reject 落进 body-read 的 catch，按 SERVER_ERROR 回 JSON。
	// 错误码不许变：500 / INTERNAL_SERVER_ERROR / 50001（与文档一致）。
	stub([["faleno.jp/top/works/", () => rejectingTextResponse()]]);
	const falenoBodyFail = await call({ code: "FNS-263", key: "test-key", only: "faleno" });
	check("status（不是 rejection，而是 500 JSON）", falenoBodyFail.status, 500);
	check("error", falenoBodyFail.body?.error, "INTERNAL_SERVER_ERROR");
	check("code", falenoBodyFail.body?.code, 50001);

	console.log("\n=== 21) 字段完整性分级 TTL：EX 只在资料不全时下发 ===");
	// 目的（spec §7）：源站后来补齐封面/预告片时最迟一个 TTL 自动生效；资料齐全的继续永久缓存；
	// `CID:` 条目按设计就只有 cid、重抓没有增量 ⇒ 豁免。假 Redis 会记录 SET 的完整参数（含 EX），
	// 但它本身**不执行** TTL（见 fake-redis.mjs 注释），所以这里断言的是"命令里有没有 EX"。
	stub(digitalRoutes()); // 完整条目：标题 / 封面 / 预告片齐全
	redis.commands.length = 0;
	const fullEntry = await call({ code: "BDSM-091", key: "test-key" });
	const fullSet = redis.commands.find((c) => c.name === "SET" && c.args[0] === "BDSM-091");
	check("21a status", fullEntry.status, 200);
	check("21a 资料齐全（封面与预告片都在）",
		Boolean(fullEntry.body?.cover_url) && Boolean(fullEntry.body?.preview_url), true);
	check("21a 有 SET", Boolean(fullSet), true);
	check("21a 完整条目 SET 不带 EX（永久）",
		fullSet?.args.some((a) => String(a).toUpperCase() === "EX"), false);

	// 字段缺失：无封面（packageImage.largeUrl = null）+ 无预告片（sample2DMovie 三项全空）
	stub(digitalRoutes({
		search: "ssis00001",
		cid: "ssis00001",
		image: null,
		lowest: null,
		highest: null,
		hls: null,
	}));
	redis.commands.length = 0;
	const partialEntry = await call({ code: "SSIS-001", key: "test-key" });
	const partialSet = redis.commands.find((c) => c.name === "SET" && c.args[0] === "SSIS-001");
	check("21b status", partialEntry.status, 200);
	check("21b cover_url 为 null", partialEntry.body?.cover_url, null);
	check("21b preview_url 为 null", partialEntry.body?.preview_url, null);
	check("21b 有 SET", Boolean(partialSet), true);
	check("21b 资料不全 SET 带 EX",
		partialSet?.args.some((a) => String(a).toUpperCase() === "EX"), true);
	check("21b EX 值 = 21600（6h）",
		partialSet?.args[partialSet.args.findIndex((a) => String(a).toUpperCase() === "EX") + 1], "21600");

	// CID: 条目豁免（换一个番号，避免命中上面刚写下的普通键）
	stub(digitalRoutes({ search: "mide00001", cid: "mide00001" }));
	redis.commands.length = 0;
	const cidOnlyEntry = await call({ code: "MIDE-001", key: "test-key", only: "cid" });
	const cidOnlySet = redis.commands.find((c) => c.name === "SET" && c.args[0] === "CID:MIDE-001");
	check("21c status", cidOnlyEntry.status, 200);
	check("21c 有 CID: 的 SET", Boolean(cidOnlySet), true);
	check("21c CID: 条目不带 EX（按设计就只有 cid）",
		cidOnlySet?.args.some((a) => String(a).toUpperCase() === "EX"), false);

	// 可关闭：INCOMPLETE_CACHE_TTL_SECONDS=0 ⇒ 一律永久（资料不全也不带 EX）
	const savedTtlEnv = process.env.INCOMPLETE_CACHE_TTL_SECONDS;
	process.env.INCOMPLETE_CACHE_TTL_SECONDS = "0";
	try {
		stub(digitalRoutes({
			search: "ssis00001",
			cid: "ssis00001",
			image: null,
			lowest: null,
			highest: null,
			hls: null,
		}));
		redis.commands.length = 0;
		await call({ code: "SSIS-001", key: "test-key" });
		const disabledSet = redis.commands.find((c) => c.name === "SET" && c.args[0] === "SSIS-001");
		check("21d 该策略设 0 时资料不全也不带 EX",
			disabledSet?.args.some((a) => String(a).toUpperCase() === "EX"), false);
	} finally {
		if (savedTtlEnv === undefined) delete process.env.INCOMPLETE_CACHE_TTL_SECONDS;
		else process.env.INCOMPLETE_CACHE_TTL_SECONDS = savedTtlEnv;
	}

	check("未命中路由次数（漏桩会算进来）", unstubbed, 0);
} catch (err) {
	console.log(`FAIL  handler threw: ${err?.message ?? err}`);
	failed += 1;
} finally {
	globalThis.fetch = realFetch;
	// 关掉假 Redis：不关的话监听 socket 会吊住事件循环（异常路径也一样，故放 finally）
	await redis.close();
}

console.log(`断言总数：${assertions}${failed === 0 ? "" : `（其中失败 ${failed}）`}`);
console.log(failed === 0 ? "=== 全部通过 ===" : `=== 有 ${failed} 条失败 ===`);
process.exit(failed === 0 ? 0 : 1);
