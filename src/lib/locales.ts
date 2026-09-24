import type { SupportedLocale } from "./types";

export interface LocaleMessages {
	title: string;
	loading: string;
	loadingPage: string;
	summary: (candidates: number) => string;
	noCandidatesTitle: string;
	noCandidatesDesc: string;
	unsupportedPageTitle: string;
	unsupportedPageDesc: string;
	errorTitle: string;
	errorDesc: string;
	retry: string;
	truncatedWarning: string;
	codesListTitle: string;
	settingsTitle: string;
	settingsDesc: string;
	platformNameLabel: string;
	platformUrlLabel: (name: string) => string;
	saveSettings: string;
	resetDefaults: string;
	settingsSaved: string;
	backToScanner: string;
	previewUrlLabel: string;
	locate: string;
	locateSuccess: string;
	locateNotFound: string;
	locateTitle: string;
	languageLabel: string;
	languageAuto: string;
	excludedSitesLabel: string;
	excludedSitesDesc: string;
	addSite: string;
	removeSite: string;
	sitePlaceholder: string;
	excludedSiteTitle: string;
	excludedSiteDesc: string;
	manageExcludedSites: string;
	customRegexLabel: string;
	customRegexDesc: string;
	regexSyntaxError: string;
	resetRegex: string;
	extensionVersionLabel: string;
	previewTitle: string;
	playTrailer: string;
	previewVolumeLabel: string;
	previewUnavailable: string;
	closePreview: string;
	retryTranslate: string;
	deeplApiKeyLabel: string;
}

export const messages: Record<SupportedLocale, LocaleMessages> = {
  "zh-hans": {
    title: "JavCode Finder",
    loading: "正在识别与加载...",
    loadingPage: "正在读取当前页面内容...",
    summary: (candidates) => `识别到 ${candidates} 个番号`,
    noCandidatesTitle: "未发现番号",
    noCandidatesDesc: "当前页面未识别到受支持的影片番号格式。",
    unsupportedPageTitle: "页面受限",
    unsupportedPageDesc: "浏览器安全策略禁止在当前系统/扩展页面运行扫描。",
    errorTitle: "扫描错误",
    errorDesc: "扫描页面时发生错误，请重试。",
    retry: "重新尝试",
    truncatedWarning: "页面内容超过扫描上限，部分候选可能未纳入统计。",
    codesListTitle: "识别到的番号",
    settingsTitle: "搜索与跳转设置",
    settingsDesc:
      "自定义外部平台跳转规则，支持 {code} 或 {番号} 占位符。设置永久保存在本地。",
    platformNameLabel: "平台名称",
    platformUrlLabel: (name) => `${name} 链接规则`,
    saveSettings: "保存设置",
    resetDefaults: "恢复默认",
    settingsSaved: "设置已保存！",
    backToScanner: "返回扫描",
    previewUrlLabel: "示例效果预览 (以 ABP-123 为例)：",
    locate: "定位",
    locateSuccess: "已定位",
    locateNotFound: "未找到",
    locateTitle: "在网页中定位此番号",
    languageLabel: "界面语言",
    languageAuto: "跟随系统",
    excludedSitesLabel: "排除站点黑名单",
    excludedSitesDesc:
      "在以下站点中插件自动停用，不执行扫描。支持子域名泛匹配。",
    addSite: "添加",
    removeSite: "移除",
    sitePlaceholder: "输入域名，如：example.com",
    excludedSiteTitle: "站点已排除",
    excludedSiteDesc: "当前站点已被加入排除黑名单，插件在此页面不执行扫描。",
    manageExcludedSites: "管理排除设置",
    customRegexLabel: "番号识别正则",
    customRegexDesc: "自定义页面番号提取的核心正则表达式规则，保存后即时生效。",
    regexSyntaxError: "正则表达式语法无效，请检查后重试",
    resetRegex: "恢复默认正则",
    extensionVersionLabel: "当前插件版本",
    previewTitle: "预告片",
    playTrailer: "播放预告片",
    previewVolumeLabel: "预览视频音量",
    previewUnavailable: "该番号暂无预告片",
    closePreview: "关闭预览",
    retryTranslate: "重新翻译",
    deeplApiKeyLabel: "DeepL API Key",
  },

  "zh-hant": {
    title: "JavCode Finder",
    loading: "正在識別與載入...",
    loadingPage: "正在讀取當前頁面內容...",
    summary: (candidates) => `識別到 ${candidates} 個番號`,
    noCandidatesTitle: "未發現番號",
    noCandidatesDesc: "當前頁面未識別到受支援的影片番號格式。",
    unsupportedPageTitle: "頁面受限",
    unsupportedPageDesc: "瀏覽器安全策略禁止在當前系統/擴充頁面執行掃描。",
    errorTitle: "掃描錯誤",
    errorDesc: "掃描頁面時發生錯誤，請重試。",
    retry: "重新嘗試",
    truncatedWarning: "頁面內容超過掃描上限，部分候選可能未納入統計。",
    codesListTitle: "識別到的番號",
    settingsTitle: "搜尋與跳轉設定",
    settingsDesc:
      "自訂外部平台跳轉規則，支援 {code} 或 {番号} 佔位符。設定永久保存在本地。",
    platformNameLabel: "平台名稱",
    platformUrlLabel: (name) => `${name} 連結規則`,
    saveSettings: "儲存設定",
    resetDefaults: "恢復預設",
    settingsSaved: "設定已儲存！",
    backToScanner: "返回掃描",
    previewUrlLabel: "範例效果預覽 (以 ABP-123 為例)：",
    locate: "定位",
    locateSuccess: "已定位",
    locateNotFound: "未找到",
    locateTitle: "在網頁中定位此番號",
    languageLabel: "介面語言",
    languageAuto: "跟隨系統",
    excludedSitesLabel: "排除站點黑名單",
    excludedSitesDesc:
      "在以下站點中擴充功能自動停用，不執行掃描。支援子網域泛匹配。",
    addSite: "新增",
    removeSite: "移除",
    sitePlaceholder: "輸入網域，如：example.com",
    excludedSiteTitle: "站點已排除",
    excludedSiteDesc:
      "當前站點已被加入排除黑名單，擴充功能在此頁面不執行掃描。",
    manageExcludedSites: "管理排除設定",
    customRegexLabel: "番號識別正則",
    customRegexDesc: "自訂頁面番號提取的核心規則表達式規則，儲存後即時生效。",
    regexSyntaxError: "規則表達式語法無效，請檢查後重試",
    resetRegex: "恢復預設正則",
    extensionVersionLabel: "目前擴充功能版本",
    previewTitle: "預告片預覽",
    playTrailer: "播放預告片",
    previewVolumeLabel: "預覽影片音量",
    previewUnavailable: "未獲取到預告片",
    closePreview: "關閉預覽",
    retryTranslate: "重新翻譯",
    deeplApiKeyLabel: "DeepL API Key",
  },

  en: {
    title: "JavCode Finder",
    loading: "Scanning and loading...",
    loadingPage: "Reading current page text...",
    summary: (candidates) => `Found ${candidates} video codes`,
    noCandidatesTitle: "No video codes found",
    noCandidatesDesc: "No supported video codes recognized on this page.",
    unsupportedPageTitle: "Unsupported page",
    unsupportedPageDesc:
      "Browser security restrictions prohibit reading this page.",
    errorTitle: "Scan error",
    errorDesc: "Something went wrong while scanning this page. Please retry.",
    retry: "Retry",
    truncatedWarning: "Page text exceeded limit; scan was partially truncated.",
    codesListTitle: "Detected Codes",
    settingsTitle: "Search & Navigation Settings",
    settingsDesc:
      "Customize external navigation rules. Supports {code} placeholder. Saved permanently in local storage.",
    platformNameLabel: "Platform name",
    platformUrlLabel: (name) => `${name} URL Template`,
    saveSettings: "Save Settings",
    resetDefaults: "Reset Defaults",
    settingsSaved: "Settings saved!",
    backToScanner: "Back to Scanner",
    previewUrlLabel: "Preview URL (e.g. ABP-123):",
    locate: "Locate",
    locateSuccess: "Located",
    locateNotFound: "Not found",
    locateTitle: "Locate this code on current page",
    languageLabel: "Language",
    languageAuto: "Follow Browser",
    excludedSitesLabel: "Excluded Sites",
    excludedSitesDesc:
      "The extension is disabled and will not scan pages on these sites. Matches subdomains automatically.",
    addSite: "Add",
    removeSite: "Remove",
    sitePlaceholder: "Domain name, e.g. example.com",
    excludedSiteTitle: "Site Excluded",
    excludedSiteDesc:
      "This site is in your excluded sites list. JavCode Finder will not scan this page.",
    manageExcludedSites: "Manage Settings",
    customRegexLabel: "Video Code Regex",
    customRegexDesc:
      "Custom regular expression pattern used to extract video codes from web pages.",
    regexSyntaxError: "Invalid regular expression syntax",
    resetRegex: "Reset to Default Regex",
    extensionVersionLabel: "Current extension version",
    previewTitle: "Trailer Preview",
    playTrailer: "Play Trailer",
    previewVolumeLabel: "Preview volume",
    previewUnavailable: "Trailer unavailable",
    closePreview: "Close preview",
    retryTranslate: "Retry translation",
    deeplApiKeyLabel: "DeepL API Key",
  },
};

export function detectLocale(): SupportedLocale {
	const lang =
		(typeof navigator !== "undefined" && navigator.language) || "en";
	const lower = lang.toLowerCase();

	if (
		lower.startsWith("zh-cn") ||
		lower.startsWith("zh-sg") ||
		lower === "zh"
	) {
		return "zh-hans";
	}
	if (
		lower.startsWith("zh-tw") ||
		lower.startsWith("zh-hk") ||
		lower.startsWith("zh-mo") ||
		lower.includes("hant")
	) {
		return "zh-hant";
	}
	return "en";
}
