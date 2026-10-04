/**
 * Emby「已在库中」图标的唯一来源：绿色星形 + 白色播放三角（evenodd 挖空）。
 *
 * 面板图标（React 组件 EmbyBadge）与目标页黄点的 Emby 图标必须同形同色。
 * 但注入进页面的 markCodesInTab 是序列化后执行的，**不能** import 任何东西，
 * 所以这里额外提供 embyBadgeSvg()：由扩展上下文生成字符串，当参数传进页面。
 */
export const EMBY_BADGE_VIEW_BOX = "155 155 714 714";

/** 白色底块：绿星三角挖空处透出的白色播放三角 */
export const EMBY_BADGE_WHITE_PATH =
	"M385.60768 361.14432h292.64896v296.27392H385.60768z";

/** 绿星外框 + 内部播放三角（fillRule=evenodd 挖空） */
export const EMBY_BADGE_GREEN_PATH =
	"M476.30336 155.01312L297.80992 333.50656l35.69664 35.69664-178.49344 178.49344 178.49344 178.49344 35.69664-35.69664 178.49344 178.49344 178.49344-178.49344-35.69664-35.69664 178.49344-178.49344-178.49344-178.49344-35.69664 35.69664-178.49344-178.49344m-35.69664 232.0384L654.7968 512 440.60672 636.94848V387.06176z";

/**
 * 生成 SVG 字符串（页面标记用 innerHTML）。size 传 CSS 长度：
 * 目标页黄点用 `1em`（尺寸随字号），面板组件自己走 JSX，不用这个函数。
 * 注意 SVG 属性名必须是短横线形式（fill-rule），innerHTML 解析不认 React 的驼峰。
 */
export function embyBadgeSvg(size: string | number): string {
	return [
		`<svg viewBox="${EMBY_BADGE_VIEW_BOX}" width="${size}" height="${size}" aria-hidden="true">`,
		`<path d="${EMBY_BADGE_WHITE_PATH}" fill="#FFFFFF"/>`,
		`<path fill-rule="evenodd" fill="#06B831" d="${EMBY_BADGE_GREEN_PATH}"/>`,
		"</svg>",
	].join("");
}
