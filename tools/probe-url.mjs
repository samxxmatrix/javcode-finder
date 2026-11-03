/**
 * 通用 URL 体检：带 Range 头请求若干 URL，打印状态 / 类型 / 长度。
 * 用途：验证封面等"模板拼出来的候选地址"是否真的存在（避免把 404 地址交给面板，比没封面更糟）。
 *
 * 用法（需代理）：node tools/probe-url.mjs <url> [更多 url...]
 */
const urls = process.argv.slice(2);
if (urls.length === 0) {
	console.error("用法: node tools/probe-url.mjs <url> [url...]");
	process.exit(2);
}

for (const url of urls) {
	try {
		const res = await fetch(url, {
			headers: {
				"User-Agent":
					"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
				Range: "bytes=0-2047",
				Referer: new URL(url).origin + "/",
			},
			redirect: "follow",
			signal: AbortSignal.timeout(20000),
		});
		const buf = Buffer.from(await res.arrayBuffer());
		console.log(
			`${res.status}  ${String(res.headers.get("content-type") ?? "-").padEnd(14)} ${String(buf.length).padStart(6)}B  ${url}`,
		);
	} catch (error) {
		console.log(`ERR   ${error.name}: ${error.message}  ${url}`);
	}
}
