import { createContext, useContext, type ReactNode } from "react";
import type { SettingsDraft } from "./useSettingsDraft";

const SettingsDraftContext = createContext<SettingsDraft | null>(null);

/**
 * 把唯一的状态源注入设置子页：两个页面共用同一份 state，
 * 切页只换渲染不卸载，未落盘的输入不会丢失。
 */
export function SettingsDraftProvider({
	value,
	children,
}: {
	value: SettingsDraft;
	children: ReactNode;
}) {
	return (
		<SettingsDraftContext.Provider value={value}>
			{children}
		</SettingsDraftContext.Provider>
	);
}

export function useDraft(): SettingsDraft {
	const ctx = useContext(SettingsDraftContext);
	if (!ctx) {
		throw new Error("useDraft 必须在 SettingsDraftProvider 内使用");
	}
	return ctx;
}
