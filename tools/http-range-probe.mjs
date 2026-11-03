/**
 * 通用 HTTP Range 探针：只取前 1KB，用来判断「不挂日本节点时某资源是否可达」
 *
 * 用法：node tools/http-range-probe.mjs <url> [<url> ...]
 */

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const urls = process.argv.slice(2);
if (urls.length === 0) {
  console.error("用法: node tools/http-range-probe.mjs <url> [<url> ...]");
  process.exit(2);
}

for (const url of urls) {
  const started = Date.now();
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Range: "bytes=0-1023" },
      redirect: "follow",
    });
    const buf = await res.arrayBuffer();
    console.log(
      [
        `status=${res.status}`,
        `type=${res.headers.get("content-type")}`,
        `content-length=${res.headers.get("content-length")}`,
        `received=${buf.byteLength}`,
        `accept-ranges=${res.headers.get("accept-ranges")}`,
        `ms=${Date.now() - started}`,
        url,
      ].join("  "),
    );
  } catch (err) {
    console.log(
      `ERR ${err.name}: ${err.message}  cause=${err.cause?.code ?? ""}  ms=${Date.now() - started}  ${url}`,
    );
  }
}
