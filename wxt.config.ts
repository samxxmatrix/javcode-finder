import { execFileSync } from "node:child_process";
import { defineConfig } from "wxt";
import { parseRepoSlug } from "./scripts/release-lib.ts";

/**
 * 更新检查地址必须指向**真正发布**的仓库：构建时从 git remote 推导，
 * 需要时用环境变量 RELEASES_REPO=owner/repo 覆盖（例如从镜像仓库构建、发到主仓库）。
 * 推导不出来就不注入，运行时会用 src/lib/release.ts 里的回退值。
 */
function detectReleasesRepo(): string | null {
  const override = (process.env.RELEASES_REPO ?? "").trim();
  if (override) return override;
  try {
    return parseRepoSlug(
      execFileSync("git", ["remote", "get-url", "origin"], { encoding: "utf8" }),
    );
  } catch {
    return null;
  }
}

const releasesRepo = detectReleasesRepo();

export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  vite: () =>
    releasesRepo
      ? { define: { __RELEASES_REPO__: JSON.stringify(releasesRepo) } }
      : {},
  manifest: {
    name: "JavCode Finder",
    description: "Scan video codes on the current page and preview covers and trailers from JavTrailers",
    // 版本号唯一来源是 package.json：WXT 会自动注入 manifest.version。
    // 这里不要再写 version —— 两处各写一次必然漂移（实测删掉本行后产物仍是 package.json 的版本）。
    icons: {
      16: "icons/icon-16.png",
      32: "icons/icon-32.png",
      48: "icons/icon-48.png",
      128: "icons/icon-128.png",
    },
    action: {
      default_title: "JavCode Finder",
      default_icon: {
        16: "icons/icon-16.png",
        32: "icons/icon-32.png",
        48: "icons/icon-48.png",
        128: "icons/icon-128.png",
      },
    },
    permissions: [
      "activeTab",
      "scripting",
      "sidePanel",
      "tabs",
      "storage",
      "declarativeNetRequest",
      "declarativeNetRequestWithHostAccess",
    ],
    host_permissions: ["*://*/*"],
    browser_specific_settings: {
      gecko: {
        id: "javcode-finder@example.com",
        data_collection_permissions: {
          required: ["none"],
        },
      },
    },
  },
});
