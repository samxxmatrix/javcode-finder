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
	/** 收藏夹切换按钮文案 */
	favoritesToggle: string;
	/** 收藏夹模式下列表标题（替代 codesListTitle） */
	favoritesListTitle: string;
	/** 收藏夹为空时的占位文案 */
	favoritesEmpty: string;
	/** 分块渲染的「显示更多」（保留以兼容旧引用） */
	loadMore: string;
	/** 收藏夹分页小点的无障碍标签，参数为页码（从 1 起） */
	pageLabel: (n: number) => string;
	/** 分页左箭头（上一页）无障碍标签 */
	prevPage: string;
	/** 分页右箭头（下一页）无障碍标签 */
	nextPage: string;
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
	saveHint: string;
	searchCodePlaceholder: string;
	searchCodeLabel: string;
	settingsSaved: string;
	backToScanner: string;
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
	checkUpdateAction: string;
	upToDateLabel: string;
	updateAvailableShort: string;
	downloadUpdate: string;
	updateCheckFailed: string;
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
	/** 播放失败文案（带来源）：来源标签只在播放失败时报出，常态不显示 */
	playbackFailedBySource: (label: string) => string;
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
	cloudSyncDesc: string;
	webdavUrlPlaceholder: string;
	webdavUserPlaceholder: string;
	webdavPassPlaceholder: string;
	webdavConnected: string;
	webdavIncomplete: string;
	webdavAuthError: string;
	webdavNotFound: string;
	webdavRateLimited: string;
	webdavConnectError: string;
	cloudSettingsFound: (time?: string) => string;
	cloudRestoreFromCloud: string;
	cloudOverwriteCloud: string;
	cloudSettingsRestored: string;
	cloudSettingsSynced: string;
	cloudPushFailed: (status: number) => string;
	cloudReadFailed: (status: number) => string;
	settingsSavedCloud: string;
	cloudSyncDisabled: string;
	cloudEnableAndUpload: string;
	showPassword: string;
	hidePassword: string;
	dmmApiUrlLabel: string;
	dmmApiKeyLabel: string;
	dmmEnableLabel: string;
	d2passApiUrlLabel: string;
	d2passApiKeyLabel: string;
	d2passEnableLabel: string;
	codeExcludeRegexLabel: string;
	codeExcludeRegexDesc: string;
	embyUrlLabel: string;
	embyApiKeyLabel: string;
	embyEnableLabel: string;
	embySourceLabel: string;
	embyIncomplete: string;
	embyInLibrary: string;
	embySyncNow: string;
	embySyncedAtLabel: (time: string) => string;
	embyItemCountLabel: (count: number) => string;
	embyNotSynced: string;
	embySyncFailed: string;
	embyTooLarge: string;
	dmmIncomplete: string;
	d2passIncomplete: string;
	falenoPrefixesLabel: string;
	falenoPrefixesDesc: string;
	falenoPrefixPlaceholder: string;
	falenoSourceLabel: string;
	fc2SourceLabel: string;
	d2passSourceLabel: string;
	// ---- 两页式设置页（基础/进阶）----
	settingsTabBasic: string;
	settingsTabAdvanced: string;
	autosaveSaving: string;
	autosaveSaved: string;
	settingsGroupVersion: string;
	settingsGroupInterface: string;
	settingsGroupBasicTranslate: string;
	settingsGroupJump: string;
	settingsGroupSources: string;
	settingsGroupTranslateService: string;
	settingsGroupCodeRules: string;
	settingsGroupSync: string;
	settingsGroupDanger: string;
	statusEnabled: string;
	statusConfiguredOff: string;
	statusNotConfigured: string;
	configuredCount: (count: number, total: number) => string;
	platformCount: (count: number) => string;
	platformRulesLabel: string;
	basicTranslateDesc: string;
	translatePriorityDesc: string;
	translateServiceLabel: string;
	/** 自建翻译服务不可达（网络/5xx）时的用量区提示 */
	translateServiceOffline: string;
	/** 用量/健康刷新进行中的提示 */
	translateUsageLoading: string;
	resetDefaultsDesc: string;
	resetConfirm: string;
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
    favoritesToggle: "收藏夹",
    favoritesListTitle: "收藏夹的番号",
    favoritesEmpty: "收藏夹为空，去「识别到的番号」里收藏吧",
    loadMore: "显示更多",
    pageLabel: (n) => `第 ${n} 页`,
    prevPage: "上一页",
    nextPage: "下一页",
    settingsTitle: "搜索与跳转设置",
    settingsDesc:
      "自定义外部平台跳转规则，支持 {code} 或 {番号} 占位符。示例效果预览 (以 ABP-123 为例)：https://example.com/search?q=ABP-123。链接规则填写：https://example.com/search?q={code}",
    platformNameLabel: "平台名称",
    platformUrlLabel: (name) => `${name} 链接规则`,
    customPlatformName: "自定义平台",
    clearInput: "清除内容",
    closeError: "关闭",
    translateUrlLabel: "翻译 API 地址",
    translateEnableLabel: "启用翻译",
    saveSettings: "保存设置",
    resetDefaults: "恢复默认",
    saveHint: "请保存 -->",
    searchCodePlaceholder: "输入番号",
    searchCodeLabel: "查询番号",
    settingsSaved: "设置已保存！",
    backToScanner: "返回扫描",
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
    checkUpdateAction: "检查更新",
    upToDateLabel: "已是最新",
    updateAvailableShort: "有更新",
    downloadUpdate: "下载更新",
    updateCheckFailed: "检查更新失败，请稍后重试",
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
    playbackFailedBySource: (label: string) => `${label}源播放失败`,
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
    cloudSyncDesc:
      "收藏与全部设置默认保存本地；启用后保存即同步到云盘。重装后填入云盘参数并打开开关即可恢复",
    webdavUrlPlaceholder: "云盘地址，如 https://dav.jianguoyun.com/dav/",
    webdavUserPlaceholder: "用户名（邮箱）",
    webdavPassPlaceholder: "密码",
    webdavConnected: "已连接",
    webdavIncomplete: "请补全云盘地址、用户名和密码",
    webdavAuthError: "用户名或密码错误",
    webdavNotFound: "目录不存在，检查云盘地址",
    webdavRateLimited: "请求过于频繁，请稍后重试",
    webdavConnectError: "连接失败，检查地址与网络",
    cloudSettingsFound: (time?: string) =>
      time
        ? `云端已有配置（${time}），请选择恢复或覆盖`
        : "云端已有配置，请选择恢复或覆盖",
    cloudRestoreFromCloud: "从云端恢复",
    cloudOverwriteCloud: "用本地覆盖云端",
    cloudSettingsRestored: "已从云端恢复配置",
    cloudSettingsSynced: "已同步到云端",
    cloudPushFailed: (status: number) =>
      status
        ? `云端写入失败（HTTP ${status}），检查云盘目录的写入权限`
        : "云端写入失败，检查云盘地址与网络",
    cloudReadFailed: (status: number) =>
      status
        ? `云端配置读取失败（HTTP ${status}）`
        : "云端配置读取失败，检查云盘地址与网络",
    settingsSavedCloud: "已保存并同步到云端",
    cloudSyncDisabled: "云盘同步未启用：配置只保存在本地，打开上方开关即可上传",
    cloudEnableAndUpload: "启用同步并上传",
    showPassword: "显示密码",
    hidePassword: "隐藏密码",
    dmmApiUrlLabel: "DMM API 地址",
    dmmApiKeyLabel: "DMM API Key",
    dmmEnableLabel: "启用 DMM 查询（预览/详情优先官方数据）",
    d2passApiUrlLabel: "D2PASS API 地址",
    d2passApiKeyLabel: "D2PASS API Key",
    d2passEnableLabel: "启用 D2PASS 查询（无码番号优先自建无码源）",
    codeExcludeRegexLabel: "番号排除正则",
    codeExcludeRegexDesc:
      "全局黑名单：扫描识别出的番号若匹配此正则，将从候选列表移除。匹配番号字符串本身（不是页面文本），大小写敏感，留空则不排除。仅对页面扫描生效，手动查询不受影响。",
    embyUrlLabel: "Emby 地址",
    embyApiKeyLabel: "Emby API Key",
    embyEnableLabel: "启用 Emby 媒体库查询",
    embySourceLabel: "Emby 媒体库",
    embyIncomplete: "请先填写 Emby 地址与 API Key",
    embyInLibrary: "已在 Emby 库中",
    embySyncNow: "立即同步",
    embySyncedAtLabel: (time) => `上次同步：${time}`,
    embyItemCountLabel: (count) => `已索引 ${count} 条`,
    embyNotSynced: "尚未同步",
    embySyncFailed: "同步失败（索引未更新）",
    embyTooLarge: "库条目超过 3 万，已改为逐个番号查询（不缓存索引）",
    dmmIncomplete: "请补全 DMM API 地址和 Key",
    d2passIncomplete: "请补全 D2PASS API 地址和 Key",
    falenoPrefixesLabel: "FALENO 番号前缀复查",
    falenoPrefixesDesc:
      "番号前缀以设置开头的，若普通查询无结果将至 FALENO 官网查询。清空即不启用。",
    falenoPrefixPlaceholder: "输入前缀，如 FNS",
    falenoSourceLabel: "FALENO",
    fc2SourceLabel: "FC2",
    d2passSourceLabel: "D2PASS",
    // 两页式设置页
    settingsTabBasic: "基础设置",
    settingsTabAdvanced: "进阶设置",
    autosaveSaving: "保存中…",
    autosaveSaved: "已自动保存",
    settingsGroupVersion: "版本与更新",
    settingsGroupInterface: "界面",
    settingsGroupBasicTranslate: "基础翻译",
    settingsGroupJump: "跳转与识别",
    settingsGroupSources: "数据源",
    settingsGroupTranslateService: "翻译服务",
    settingsGroupCodeRules: "番号规则",
    settingsGroupSync: "同步与备份",
    settingsGroupDanger: "恢复默认",
    statusEnabled: "已启用",
    statusConfiguredOff: "未启用",
    statusNotConfigured: "未配置",
    configuredCount: (count, total) => `已配置 ${count}/${total}`,
    platformCount: (count) => `${count} 个平台`,
    platformRulesLabel: "平台跳转规则",
    basicTranslateDesc: "进阶设置里的翻译服务未启用或不可用时，自动使用这里选择的备用翻译服务。",
    translatePriorityDesc: "启用后优先使用自建翻译服务；未启用或验证失败时自动降级到基础设置里的备用翻译。",
    translateServiceLabel: "自建翻译服务",
    translateServiceOffline: "服务离线",
    translateUsageLoading: "加载中…",
    resetDefaultsDesc: "清除全部配置并恢复出厂设置，此操作不可撤销。",
    resetConfirm: "确定要恢复默认设置吗？所有配置（含 API 地址与密钥）都会被清除。",
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
    favoritesToggle: "收藏夾",
    favoritesListTitle: "收藏夾的番號",
    favoritesEmpty: "收藏夾為空，去「識別到的番號」裡收藏吧",
    loadMore: "顯示更多",
    pageLabel: (n) => `第 ${n} 頁`,
    prevPage: "上一頁",
    nextPage: "下一頁",
    settingsTitle: "搜尋與跳轉設定",
    settingsDesc:
      "自訂外部平台跳轉規則，支援 {code} 或 {番号} 佔位符。範例效果預覽 (以 ABP-123 為例)：https://example.com/search?q=ABP-123。連結規則填寫：https://example.com/search?q={code}",
    platformNameLabel: "平台名稱",
    platformUrlLabel: (name) => `${name} 連結規則`,
    customPlatformName: "自訂平台",
    clearInput: "清除內容",
    closeError: "關閉",
    translateUrlLabel: "翻譯 API 位址",
    translateEnableLabel: "啟用翻譯",
    saveSettings: "儲存設定",
    resetDefaults: "恢復預設",
    saveHint: "請儲存 -->",
    searchCodePlaceholder: "輸入番號",
    searchCodeLabel: "查詢番號",
    settingsSaved: "設定已儲存！",
    backToScanner: "返回掃描",
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
    checkUpdateAction: "檢查更新",
    upToDateLabel: "已是最新",
    updateAvailableShort: "有更新",
    downloadUpdate: "下載更新",
    updateCheckFailed: "檢查更新失敗，請稍後重試",
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
    playbackFailedBySource: (label: string) => `${label}源播放失敗`,
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
    cloudSyncDesc:
      "收藏與全部設定預設儲存本地；啟用後儲存即同步到雲端。重裝後填入雲端參數並開啟開關即可還原",
    webdavUrlPlaceholder: "雲端地址，如 https://dav.jianguoyun.com/dav/",
    webdavUserPlaceholder: "使用者名稱（信箱）",
    webdavPassPlaceholder: "密碼",
    webdavConnected: "已連線",
    webdavIncomplete: "請補全雲端地址、使用者名稱與密碼",
    webdavAuthError: "使用者名稱或密碼錯誤",
    webdavNotFound: "目錄不存在，請檢查雲端地址",
    webdavRateLimited: "請求過於頻繁，請稍後重試",
    webdavConnectError: "連線失敗，請檢查地址與網路",
    cloudSettingsFound: (time?: string) =>
      time
        ? `雲端已有設定（${time}），請選擇還原或覆蓋`
        : "雲端已有設定，請選擇還原或覆蓋",
    cloudRestoreFromCloud: "從雲端還原",
    cloudOverwriteCloud: "用本地覆蓋雲端",
    cloudSettingsRestored: "已從雲端還原設定",
    cloudSettingsSynced: "已同步到雲端",
    cloudPushFailed: (status: number) =>
      status
        ? `雲端寫入失敗（HTTP ${status}），請檢查雲端目錄的寫入權限`
        : "雲端寫入失敗，請檢查雲端位址與網路",
    cloudReadFailed: (status: number) =>
      status
        ? `雲端設定讀取失敗（HTTP ${status}）`
        : "雲端設定讀取失敗，請檢查雲端位址與網路",
    settingsSavedCloud: "已儲存並同步到雲端",
    cloudSyncDisabled: "雲端同步未啟用：設定只儲存在本地，開啟上方開關即可上傳",
    cloudEnableAndUpload: "啟用同步並上傳",
    showPassword: "顯示密碼",
    hidePassword: "隱藏密碼",
    dmmApiUrlLabel: "DMM API 位址",
    dmmApiKeyLabel: "DMM API Key",
    dmmEnableLabel: "啟用 DMM 查詢（預覽/詳情優先官方資料）",
    d2passApiUrlLabel: "D2PASS API 位址",
    d2passApiKeyLabel: "D2PASS API Key",
    d2passEnableLabel: "啟用 D2PASS 查詢（無碼番號優先自建無碼源）",
    codeExcludeRegexLabel: "番號排除正則",
    codeExcludeRegexDesc:
      "全域黑名單：掃描辨識出的番號若符合此正則，將從候選清單移除。比對番號字串本身（非頁面文字），大小寫敏感，留空則不排除。僅對頁面掃描生效，手動查詢不受影響。",
    embyUrlLabel: "Emby 位址",
    embyApiKeyLabel: "Emby API Key",
    embyEnableLabel: "啟用 Emby 媒體庫查詢",
    embySourceLabel: "Emby 媒體庫",
    embyIncomplete: "請先填寫 Emby 位址與 API Key",
    embyInLibrary: "已在 Emby 媒體庫中",
    embySyncNow: "立即同步",
    embySyncedAtLabel: (time) => `上次同步：${time}`,
    embyItemCountLabel: (count) => `已索引 ${count} 條`,
    embyNotSynced: "尚未同步",
    embySyncFailed: "同步失敗（索引未更新）",
    embyTooLarge: "庫條目超過 3 萬，已改為逐個番號查詢（不建立索引）",
    dmmIncomplete: "請補全 DMM API 位址與 Key",
    d2passIncomplete: "請補全 D2PASS API 位址與 Key",
    falenoPrefixesLabel: "FALENO 番號前綴複查",
    falenoPrefixesDesc:
      "番號前綴以設定開頭的，若普通查詢無結果將至 FALENO 官網查詢。清空即不啟用。",
    falenoPrefixPlaceholder: "輸入前綴，如 FNS",
    falenoSourceLabel: "FALENO",
    fc2SourceLabel: "FC2",
    d2passSourceLabel: "D2PASS",
    // 兩頁式設定頁
    settingsTabBasic: "基礎設定",
    settingsTabAdvanced: "進階設定",
    autosaveSaving: "儲存中…",
    autosaveSaved: "已自動儲存",
    settingsGroupVersion: "版本與更新",
    settingsGroupInterface: "介面",
    settingsGroupBasicTranslate: "基礎翻譯",
    settingsGroupJump: "跳轉與識別",
    settingsGroupSources: "資料來源",
    settingsGroupTranslateService: "翻譯服務",
    settingsGroupCodeRules: "番號規則",
    settingsGroupSync: "同步與備份",
    settingsGroupDanger: "恢復預設",
    statusEnabled: "已啟用",
    statusConfiguredOff: "未啟用",
    statusNotConfigured: "未設定",
    configuredCount: (count, total) => `已設定 ${count}/${total}`,
    platformCount: (count) => `${count} 個平台`,
    platformRulesLabel: "平台跳轉規則",
    basicTranslateDesc: "進階設定裡的翻譯服務未啟用或不可用時，自動使用這裡選擇的備用翻譯服務。",
    translatePriorityDesc: "啟用後優先使用自建翻譯服務；未啟用或驗證失敗時自動降級到基礎設定裡的備用翻譯。",
    translateServiceLabel: "自建翻譯服務",
    translateServiceOffline: "服務離線",
    translateUsageLoading: "載入中…",
    resetDefaultsDesc: "清除全部設定並恢復出廠預設，此操作無法復原。",
    resetConfirm: "確定要恢復預設設定嗎？所有設定（含 API 位址與金鑰）都會被清除。",
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
    favoritesToggle: "Favorites",
    favoritesListTitle: "Favorite Codes",
    favoritesEmpty: "Favorites is empty — favorite some codes first",
    loadMore: "Load more",
    pageLabel: (n) => `Page ${n}`,
    prevPage: "Previous page",
    nextPage: "Next page",
    settingsTitle: "Search & Navigation Settings",
    settingsDesc:
      "Customize external navigation rules, supporting {code} or {番号} placeholders. Preview example (ABP-123): https://example.com/search?q=ABP-123. Fill the rule with: https://example.com/search?q={code}",
    platformNameLabel: "Platform name",
    platformUrlLabel: (name) => `${name} URL Template`,
    customPlatformName: "Custom Platform",
    clearInput: "Clear",
    closeError: "Close",
    translateUrlLabel: "Translation API URL",
    translateEnableLabel: "Enable Translation",
    saveSettings: "Save Settings",
    resetDefaults: "Reset Defaults",
    saveHint: "Please save -->",
    searchCodePlaceholder: "Enter code",
    searchCodeLabel: "Search Code",
    settingsSaved: "Settings saved!",
    backToScanner: "Back to Scanner",
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
    checkUpdateAction: "Check for updates",
    upToDateLabel: "Up to date",
    updateAvailableShort: "Update available",
    downloadUpdate: "Download update",
    updateCheckFailed: "Update check failed. Try again later.",
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
    playbackFailedBySource: (label: string) => `${label} trailer playback failed`,
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
    cloudSyncDesc:
      "Favorites and all settings are stored locally; when enabled, saving syncs them to your cloud drive. After a reinstall, enter the WebDAV details and turn the switch on to restore everything",
    webdavUrlPlaceholder: "WebDAV URL, e.g. https://dav.jianguoyun.com/dav/",
    webdavUserPlaceholder: "Username (email)",
    webdavPassPlaceholder: "Password",
    webdavConnected: "Connected",
    webdavIncomplete: "Fill in the URL, username and password",
    webdavAuthError: "Invalid username or password",
    webdavNotFound: "Directory not found, check the URL",
    webdavRateLimited: "Too many requests, try again later",
    webdavConnectError: "Connection failed, check the URL and network",
    cloudSettingsFound: (time?: string) =>
      time
        ? `Cloud backup found (updated ${time}). Restore it, or overwrite it with local settings?`
        : "Cloud backup found. Restore it, or overwrite it with local settings?",
    cloudRestoreFromCloud: "Restore from cloud",
    cloudOverwriteCloud: "Overwrite cloud with local",
    cloudSettingsRestored: "Settings restored from cloud",
    cloudSettingsSynced: "Synced to cloud",
    cloudPushFailed: (status: number) =>
      status
        ? `Cloud write failed (HTTP ${status}); check write access to the WebDAV folder`
        : "Cloud write failed; check the WebDAV URL and network",
    cloudReadFailed: (status: number) =>
      status
        ? `Failed to read the cloud settings (HTTP ${status})`
        : "Failed to read the cloud settings; check the WebDAV URL and network",
    settingsSavedCloud: "Saved and synced to cloud",
    cloudSyncDisabled: "Cloud sync is off: settings stay local. Turn the switch on to upload",
    cloudEnableAndUpload: "Enable sync and upload",
    showPassword: "Show password",
    hidePassword: "Hide password",
    dmmApiUrlLabel: "DMM API URL",
    dmmApiKeyLabel: "DMM API Key",
    dmmEnableLabel: "Enable DMM lookup (official data first)",
    d2passApiUrlLabel: "D2PASS API URL",
    d2passApiKeyLabel: "D2PASS API Key",
    d2passEnableLabel: "Enable D2PASS lookup (uncensored codes first)",
    codeExcludeRegexLabel: "Code exclusion regex",
    codeExcludeRegexDesc:
      "Global blacklist: a code found by page scanning is dropped from the candidate list if it matches this regex. It matches the code string itself (not page text), is case-sensitive, and an empty value means no exclusion. It only affects page scanning; manual lookups are unaffected.",
    embyUrlLabel: "Emby URL",
    embyApiKeyLabel: "Emby API Key",
    embyEnableLabel: "Enable Emby library lookup",
    embySourceLabel: "Emby Library",
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
    d2passIncomplete: "Fill in the D2PASS API URL and Key",
    falenoPrefixesLabel: "FALENO code prefix check",
    falenoPrefixesDesc:
      "Codes whose prefixes match the settings fall back to the FALENO official site when the normal lookup finds nothing. Clearing the list disables it.",
    falenoPrefixPlaceholder: "Prefix, e.g. FNS",
    falenoSourceLabel: "FALENO",
    fc2SourceLabel: "FC2",
    d2passSourceLabel: "D2PASS",
    // Two-page settings (basic / advanced)
    settingsTabBasic: "Basic",
    settingsTabAdvanced: "Advanced",
    autosaveSaving: "Saving…",
    autosaveSaved: "Saved automatically",
    settingsGroupVersion: "Version & Updates",
    settingsGroupInterface: "Interface",
    settingsGroupBasicTranslate: "Basic Translation",
    settingsGroupJump: "Jump & Detection",
    settingsGroupSources: "Data Sources",
    settingsGroupTranslateService: "Translation Service",
    settingsGroupCodeRules: "Code Rules",
    settingsGroupSync: "Sync & Backup",
    settingsGroupDanger: "Reset Defaults",
    statusEnabled: "Enabled",
    statusConfiguredOff: "Off",
    statusNotConfigured: "Not configured",
    configuredCount: (count, total) => `${count}/${total} configured`,
    platformCount: (count) => `${count} platforms`,
    platformRulesLabel: "Platform jump rules",
    basicTranslateDesc: "When the advanced translation service is off or unavailable, the fallback service selected here is used automatically.",
    translatePriorityDesc: "When enabled, your own translation service is used first; it falls back to the basic translation service if disabled or verification fails.",
    translateServiceLabel: "Custom translation service",
    translateServiceOffline: "Service offline",
    translateUsageLoading: "Loading…",
    resetDefaultsDesc: "Clear all settings and restore factory defaults. This cannot be undone.",
    resetConfirm: "Reset all settings to defaults? All configuration (including API URLs and keys) will be cleared.",
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
