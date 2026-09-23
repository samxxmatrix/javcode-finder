import { defineConfig } from "wxt";
import { EXTENSION_VERSION } from "./src/lib/release";

export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  manifest: {
    name: "JavCode Finder",
    description: "Scan video codes on the current page and preview covers and trailers from JavTrailers",
    version: EXTENSION_VERSION,
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
