/** 版本检查的展示状态；由 App 持有并传入，设置页只负责渲染与触发 */
export interface UpdateCheckInfo {
	status: "idle" | "checking" | "latest" | "update" | "error";
	/** 远端 Release 的最新版本号；null = 还没查到过 */
	remoteVersion: string | null;
	/** 有更新时的下载 / 发布页地址；null = 没有可下载目标 */
	downloadUrl: string | null;
	/** 上次成功检查的时间戳；null = 从未检查 */
	checkedAt: number | null;
	onCheck: () => void;
}
