import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import "./style.css";

// 立即应用主题：在 React 渲染前读取设置，避免闪烁
(function applyInitialTheme() {
	try {
		const storage = window.localStorage;
		const raw = storage.getItem("javranking_search_settings");
		if (!raw) return;
		const settings = JSON.parse(raw);
		const theme = settings.theme;
		if (theme === "light" || theme === "dark") {
			document.documentElement.setAttribute("data-theme", theme);
		} else if (theme === "system") {
			const isDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
			document.documentElement.setAttribute("data-theme", isDark ? "dark" : "light");
		}
	} catch (e) {
		// 忽略错误，保持默认深色
	}
})();

const root = document.getElementById("root");
if (root) {
	ReactDOM.createRoot(root).render(
		<React.StrictMode>
			<App />
		</React.StrictMode>,
	);
}
