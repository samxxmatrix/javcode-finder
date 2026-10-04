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
	customPlatformName: string;
	clearInput: string;
	closeError: string;
	translateUrlLabel: string;
	translateEnableLabel: string;
	saveSettings: string;
	resetDefaults: string;
	searchCodePlaceholder: string;
	searchCodeLabel: string;
	settingsSaved: string;
	backToScanner: string;
	previewUrlLabel: string;
	reloadPreview: string;
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
	updateAvailableTitle: (version: string) => string;
	updateAvailableDesc: string;
	updateNow: string;
	updateAvailableAria: (version: string) => string;
	previewTitle: string;
	playTrailer: string;
	previewVolumeLabel: string;
	previewUnavailable: string;
	noNumberInformation: string;
	noTrailer: string;
	playbackFailed: string;
	dmmSourceLabel: string;
	javtrailersSourceLabel: string;
	sourceErrorPrefix: string;
	usedFallback: string;
	lookupRetry: string;
	playbackRetry: string;
	closePreview: string;
	retryTranslate: string;
	googleVerifyHint: string;
	openVerifyPage: string;
	deeplApiKeyLabel: string;
	fallbackServiceLabel: string;
	fallbackGoogle: string;
	fallbackBing: string;
	translateApiIncomplete: string;
	verifyFailed: string;
	unknownError: string;
	networkError: string;
	timeoutError: string;
	abnormalResponse: string;
	dmmError: string;
	addFavorite: string;
	removeFavorite: string;
	cloudSyncLabel: string;
	webdavUrlPlaceholder: string;
	webdavUserPlaceholder: string;
	webdavPassPlaceholder: string;
	webdavConnected: string;
	webdavIncomplete: string;
	webdavAuthError: string;
	webdavNotFound: string;
	webdavRateLimited: string;
	webdavConnectError: string;
	showPassword: string;
	hidePassword: string;
	dmmApiUrlLabel: string;
	dmmApiKeyLabel: string;
	dmmEnableLabel: string;
	embyUrlLabel: string;
	embyApiKeyLabel: string;
	embyEnableLabel: string;
	embyIncomplete: string;
	embyInLibrary: string;
	embySyncNow: string;
	embySyncedAtLabel: (time: string) => string;
	embyItemCountLabel: (count: number) => string;
	embyNotSynced: string;
	embySyncFailed: string;
	embyTooLarge: string;
	dmmIncomplete: string;
	falenoPrefixesLabel: string;
	falenoPrefixesDesc: string;
	falenoPrefixPlaceholder: string;
	falenoSourceLabel: string;
	fc2SourceLabel: string;
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
    customPlatformName: "自定义平台",
    clearInput: "清除内容",
    closeError: "关闭",
    translateUrlLabel: "翻译 API 地址",
    translateEnableLabel: "启用翻译",
    saveSettings: "保存设置",
    resetDefaults: "恢复默认",
    searchCodePlaceholder: "输入番号",
    searchCodeLabel: "查询番号",
    settingsSaved: "设置已保存！",
    backToScanner: "返回扫描",
    previewUrlLabel: "示例效果预览 (以 ABP-123 为例)：",
    reloadPreview: "重新加载预览",
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
    updateAvailableTitle: (version) => `发现新版本 v${version}`,
    updateAvailableDesc: "扩展每 24 小时检查一次；前往 GitHub Release 下载新包并解压覆盖。",
    updateNow: "立即更新",
    updateAvailableAria: (version) =>
      `发现新版本 v${version}，在新标签页打开 GitHub 最新 Release`,
    previewTitle: "预告片",
    playTrailer: "播放预告片",
    previewVolumeLabel: "预览视频音量",
    previewUnavailable: "该番号暂无预告片",
    noNumberInformation: "暂无此番号信息",
    noTrailer: "暂无预告片",
    playbackFailed: "预告片播放失败",
    dmmSourceLabel: "DMM",
    javtrailersSourceLabel: "JavTrailers",
    sourceErrorPrefix: "来源错误：",
    usedFallback: "已使用备用来源",
    lookupRetry: "重新查询",
    playbackRetry: "重新播放",
    closePreview: "关闭预览",
    retryTranslate: "重新翻译",
    googleVerifyHint: "谷歌翻译需要人工验证",
    openVerifyPage: "打开验证页面",
    deeplApiKeyLabel: "翻译 API Key",
    fallbackServiceLabel: "备用翻译服务",
    fallbackGoogle: "谷歌翻译",
    fallbackBing: "微软翻译",
    translateApiIncomplete: "翻译 API 地址和 Key 均需填写",
    verifyFailed: "接口验证失败",
    unknownError: "未知错误",
    networkError: "网络错误",
    timeoutError: "请求超时",
    abnormalResponse: "接口响应异常",
    dmmError: "DMM 接口错误",
    addFavorite: "加入收藏",
    removeFavorite: "取消收藏",
    cloudSyncLabel: "云盘同步（WebDAV）",
    webdavUrlPlaceholder: "云盘地址，如 https://dav.jianguoyun.com/dav/",
    webdavUserPlaceholder: "用户名（邮箱）",
    webdavPassPlaceholder: "密码",
    webdavConnected: "已连接",
    webdavIncomplete: "请补全云盘地址、用户名和密码",
    webdavAuthError: "用户名或密码错误",
    webdavNotFound: "目录不存在，检查云盘地址",
    webdavRateLimited: "请求过于频繁，请稍后重试",
    webdavConnectError: "连接失败，检查地址与网络",
    showPassword: "显示密码",
    hidePassword: "隐藏密码",
    dmmApiUrlLabel: "DMM API 地址",
    dmmApiKeyLabel: "DMM API Key",
    dmmEnableLabel: "启用 DMM 查询（预览/详情优先官方数据）",
    embyUrlLabel: "Emby 地址",
    embyApiKeyLabel: "Emby API Key",
    embyEnableLabel: "启用 Emby 媒体库查询",
    embyIncomplete: "请先填写 Emby 地址与 API Key",
    embyInLibrary: "已在 Emby 库中",
    embySyncNow: "立即同步",
    embySyncedAtLabel: (time) => `上次同步：${time}`,
    embyItemCountLabel: (count) => `已索引 ${count} 条`,
    embyNotSynced: "尚未同步",
    embySyncFailed: "同步失败（索引未更新）",
    embyTooLarge: "库条目超过 3 万，已改为逐个番号查询（不缓存索引）",
    dmmIncomplete: "请补全 DMM API 地址和 Key",
    falenoPrefixesLabel: "FALENO 番号前缀复查",
    falenoPrefixesDesc:
      "番号前缀以设置开头的，若普通查询无结果将至 FALENO 官网查询。清空即不启用。",
    falenoPrefixPlaceholder: "输入前缀，如 FNS",
    falenoSourceLabel: "FALENO",
    fc2SourceLabel: "FC2",
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
    customPlatformName: "自訂平台",
    clearInput: "清除內容",
    closeError: "關閉",
    translateUrlLabel: "翻譯 API 位址",
    translateEnableLabel: "啟用翻譯",
    saveSettings: "儲存設定",
    resetDefaults: "恢復預設",
    searchCodePlaceholder: "輸入番號",
    searchCodeLabel: "查詢番號",
    settingsSaved: "設定已儲存！",
    backToScanner: "返回掃描",
    previewUrlLabel: "範例效果預覽 (以 ABP-123 為例)：",
    reloadPreview: "重新載入預覽",
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
    updateAvailableTitle: (version) => `發現新版本 v${version}`,
    updateAvailableDesc: "擴充功能每 24 小時檢查一次；前往 GitHub Release 下載新包並解壓覆蓋。",
    updateNow: "立即更新",
    updateAvailableAria: (version) =>
      `發現新版本 v${version}，在新分頁開啟 GitHub 最新 Release`,
    previewTitle: "預告片預覽",
    playTrailer: "播放預告片",
    previewVolumeLabel: "預覽影片音量",
    previewUnavailable: "未獲取到預告片",
    noNumberInformation: "暫無此番號資訊",
    noTrailer: "暫無預告片",
    playbackFailed: "預告片播放失敗",
    dmmSourceLabel: "DMM",
    javtrailersSourceLabel: "JavTrailers",
    sourceErrorPrefix: "來源錯誤：",
    usedFallback: "已使用備用來源",
    lookupRetry: "重新查詢",
    playbackRetry: "重新播放",
    closePreview: "關閉預覽",
    retryTranslate: "重新翻譯",
    googleVerifyHint: "谷歌翻譯需要人工驗證",
    openVerifyPage: "開啟驗證頁面",
    deeplApiKeyLabel: "翻譯 API Key",
    fallbackServiceLabel: "備用翻譯服務",
    fallbackGoogle: "谷歌翻譯",
    fallbackBing: "微軟翻譯",
    translateApiIncomplete: "翻譯 API 地址和 Key 均需填寫",
    verifyFailed: "介面驗證失敗",
    unknownError: "未知錯誤",
    networkError: "網路錯誤",
    timeoutError: "請求逾時",
    abnormalResponse: "介面回應異常",
    dmmError: "DMM 介面錯誤",
    addFavorite: "加入收藏",
    removeFavorite: "取消收藏",
    cloudSyncLabel: "雲端同步（WebDAV）",
    webdavUrlPlaceholder: "雲端地址，如 https://dav.jianguoyun.com/dav/",
    webdavUserPlaceholder: "使用者名稱（信箱）",
    webdavPassPlaceholder: "密碼",
    webdavConnected: "已連線",
    webdavIncomplete: "請補全雲端地址、使用者名稱與密碼",
    webdavAuthError: "使用者名稱或密碼錯誤",
    webdavNotFound: "目錄不存在，請檢查雲端地址",
    webdavRateLimited: "請求過於頻繁，請稍後重試",
    webdavConnectError: "連線失敗，請檢查地址與網路",
    showPassword: "顯示密碼",
    hidePassword: "隱藏密碼",
    dmmApiUrlLabel: "DMM API 位址",
    dmmApiKeyLabel: "DMM API Key",
    dmmEnableLabel: "啟用 DMM 查詢（預覽/詳情優先官方資料）",
    embyUrlLabel: "Emby 位址",
    embyApiKeyLabel: "Emby API Key",
    embyEnableLabel: "啟用 Emby 媒體庫查詢",
    embyIncomplete: "請先填寫 Emby 位址與 API Key",
    embyInLibrary: "已在 Emby 媒體庫中",
    embySyncNow: "立即同步",
    embySyncedAtLabel: (time) => `上次同步：${time}`,
    embyItemCountLabel: (count) => `已索引 ${count} 條`,
    embyNotSynced: "尚未同步",
    embySyncFailed: "同步失敗（索引未更新）",
    embyTooLarge: "庫條目超過 3 萬，已改為逐個番號查詢（不建立索引）",
    dmmIncomplete: "請補全 DMM API 位址與 Key",
    falenoPrefixesLabel: "FALENO 番號前綴複查",
    falenoPrefixesDesc:
      "番號前綴以設定開頭的，若普通查詢無結果將至 FALENO 官網查詢。清空即不啟用。",
    falenoPrefixPlaceholder: "輸入前綴，如 FNS",
    falenoSourceLabel: "FALENO",
    fc2SourceLabel: "FC2",
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
    customPlatformName: "Custom Platform",
    clearInput: "Clear",
    closeError: "Close",
    translateUrlLabel: "Translation API URL",
    translateEnableLabel: "Enable Translation",
    saveSettings: "Save Settings",
    resetDefaults: "Reset Defaults",
    searchCodePlaceholder: "Enter code",
    searchCodeLabel: "Search Code",
    settingsSaved: "Settings saved!",
    backToScanner: "Back to Scanner",
    previewUrlLabel: "Preview URL (e.g. ABP-123):",
    reloadPreview: "Reload preview",
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
    updateAvailableTitle: (version) => `Version ${version} is available`,
    updateAvailableDesc:
      "Checked once every 24 hours; download the new ZIP from GitHub Releases and replace the old folder.",
    updateNow: "Update now",
    updateAvailableAria: (version) =>
      `Version ${version} is available. Open the latest GitHub Release in a new tab`,
    previewTitle: "Trailer Preview",
    playTrailer: "Play Trailer",
    previewVolumeLabel: "Preview volume",
    previewUnavailable: "Trailer unavailable",
    noNumberInformation: "No information is available for this code",
    noTrailer: "No trailer available",
    playbackFailed: "Trailer playback failed",
    dmmSourceLabel: "DMM",
    javtrailersSourceLabel: "JavTrailers",
    sourceErrorPrefix: "Source error:",
    usedFallback: "Using a fallback source",
    lookupRetry: "Retry lookup",
    playbackRetry: "Retry playback",
    closePreview: "Close preview",
    retryTranslate: "Retry translation",
    googleVerifyHint: "Google Translate needs human verification",
    openVerifyPage: "Open verification page",
    deeplApiKeyLabel: "翻译 API Key",
    fallbackServiceLabel: "Fallback translation service",
    fallbackGoogle: "Google Translate",
    fallbackBing: "Microsoft Translate",
    translateApiIncomplete: "Translation API URL and Key are both required",
    verifyFailed: "Interface verification failed",
    unknownError: "Unknown error",
    networkError: "Network error",
    timeoutError: "Request timed out",
    abnormalResponse: "Unexpected interface response",
    dmmError: "DMM API error",
    addFavorite: "Add to favorites",
    removeFavorite: "Remove from favorites",
    cloudSyncLabel: "Cloud Sync (WebDAV)",
    webdavUrlPlaceholder: "WebDAV URL, e.g. https://dav.jianguoyun.com/dav/",
    webdavUserPlaceholder: "Username (email)",
    webdavPassPlaceholder: "Password",
    webdavConnected: "Connected",
    webdavIncomplete: "Fill in the URL, username and password",
    webdavAuthError: "Invalid username or password",
    webdavNotFound: "Directory not found, check the URL",
    webdavRateLimited: "Too many requests, try again later",
    webdavConnectError: "Connection failed, check the URL and network",
    showPassword: "Show password",
    hidePassword: "Hide password",
    dmmApiUrlLabel: "DMM API URL",
    dmmApiKeyLabel: "DMM API Key",
    dmmEnableLabel: "Enable DMM lookup (official data first)",
    embyUrlLabel: "Emby URL",
    embyApiKeyLabel: "Emby API Key",
    embyEnableLabel: "Enable Emby library lookup",
    embyIncomplete: "Fill in the Emby URL and Key",
    embyInLibrary: "In your Emby library",
    embySyncNow: "Sync now",
    embySyncedAtLabel: (time) => `Last synced: ${time}`,
    embyItemCountLabel: (count) => `${count} items indexed`,
    embyNotSynced: "Not synced yet",
    embySyncFailed: "Sync failed (index not updated)",
    embyTooLarge:
      "Library has over 30,000 items; using per-code lookup instead of a cached index",
    dmmIncomplete: "Fill in the DMM API URL and Key",
    falenoPrefixesLabel: "FALENO code prefix check",
    falenoPrefixesDesc:
      "Codes whose prefixes match the settings fall back to the FALENO official site when the normal lookup finds nothing. Clearing the list disables it.",
    falenoPrefixPlaceholder: "Prefix, e.g. FNS",
    falenoSourceLabel: "FALENO",
    fc2SourceLabel: "FC2",
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
