import { defineConfig } from "wxt";

export default defineConfig({
  modules: ["@wxt-dev/module-react"],
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
