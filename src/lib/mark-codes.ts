/**
 * Self-contained function executed in host page top-level document via scripting.executeScript.
 * Must not reference external closure variables.
 */
export function clearCodeMarksInTab(): void {
	try {
		// 类名硬编码：executeScript 序列化 func 时外部变量不会跟随注入
		// 清理圆点
		document.querySelectorAll(".javcode-dot").forEach((el) => {
			const parent = el.parentNode;
			if (parent) {
				parent.removeChild(el);
				parent.normalize();
			}
		});
		// 清理金底黑字标记（含点击圆点产生的高亮与定位高亮）：内容展开回普通文本
		document.querySelectorAll(".javcode-locate-badge").forEach((el) => {
			const parent = el.parentNode;
			if (parent) {
				while (el.firstChild) {
					parent.insertBefore(el.firstChild, el);
				}
				parent.removeChild(el);
				parent.normalize();
			}
		});
	} catch {
		// 不支持注入的页面（如浏览器内置页）静默跳过
	}
}

/**
 * Self-contained function executed in host page top-level document via scripting.executeScript.
 * Must not reference external closure variables.
 *
 * 在每个已识别番号的页面匹配文本末尾插入金色实心小圆点；
 * 点击圆点只发消息 jt:code-clicked 给面板打开预告片预览（不做定位）。
 */
export function markCodesInTab(codes: string[], perCodeLimit = 30): void {
	try {
		// 先清理旧标记（逻辑内联：注入函数不能引用模块级函数或常量）
		// 圆点直接移除；金底黑字标记展开回普通文本后移除
		document.querySelectorAll(".javcode-dot").forEach((el) => {
			const parent = el.parentNode;
			if (parent) {
				parent.removeChild(el);
				parent.normalize();
			}
		});
		document.querySelectorAll(".javcode-locate-badge").forEach((el) => {
			const parent = el.parentNode;
			if (parent) {
				while (el.firstChild) {
					parent.insertBefore(el.firstChild, el);
				}
				parent.removeChild(el);
				parent.normalize();
			}
		});
		if (!codes || codes.length === 0 || !document.body) return;

		// 去重（识别结果已按大写去重，这里防御脏数据）
		const seen = new Set<string>();
		const unique: string[] = [];
		for (const raw of codes) {
			const code = String(raw).trim();
			const key = code.toUpperCase();
			if (code && !seen.has(key)) {
				seen.add(key);
				unique.push(code);
			}
		}
		if (unique.length === 0) return;

		// 与定位相同的宽松匹配：分隔符宽容（连字符/空格互替）+ FC2 PPV 变体
		const buildPattern = (raw: string): string => {
			const escaped = raw.replace(/[\\^$*+?.()|[\]{}]/g, "\\$&");
			if (/^FC2/i.test(raw)) {
				const numPart = raw.replace(/^FC2[-_\s]*(?:PPV[-_\s]*)?/i, "");
				const escapedNum = numPart.replace(/[\\^$*+?.()|[\]{}]/g, "\\$&");
				return `FC2[-_\\s]*(?:PPV[-_\\s]*)?${escapedNum}`;
			}
			return escaped.replace(/[-_\s]+/g, "[-_\\s]?");
		};

		// 候选多时单个 alternation 正则过长，按 25 个一组分块；
		// 每支用捕获组包裹，匹配后按捕获组下标反查命中的候选（用于上限计数）
		const CHUNK_SIZE = 25;
		const chunks: string[][] = [];
		for (let i = 0; i < unique.length; i += CHUNK_SIZE) {
			chunks.push(unique.slice(i, i + CHUNK_SIZE));
		}

		const chunkedRegexes = chunks.map((chunk) => {
			const body = chunk.map((c) => `(${buildPattern(c)})`).join("|");
			let regex: RegExp;
			try {
				regex = new RegExp(`(?<![A-Za-z0-9])(?:${body})(?![A-Za-z0-9])`, "gi");
			} catch {
				regex = new RegExp(`\\b(?:${body})\\b`, "gi");
			}
			return { chunk, regex };
		});

		const counts = new Map<string, number>();

		const isElementVisible = (el: HTMLElement | null): boolean => {
			if (!el) return false;
			if (typeof el.checkVisibility === "function") {
				return el.checkVisibility({
					checkOpacity: true,
					checkVisibilityCSS: true,
				});
			}
			const rects = el.getClientRects();
			if (rects.length === 0) return false;
			const style =
				window.getComputedStyle ? window.getComputedStyle(el) : null;
			if (style) {
				if (
					style.display === "none" ||
					style.visibility === "hidden" ||
					style.opacity === "0"
				) {
					return false;
				}
			}
			return true;
		};

		// 圆点样式全部内联 + !important：目标页面 CSS（含其 !important 规则）无法覆盖。
		// 尺寸用 em 单位，随番号字号缩放；透明 border 撑大点击区（同样随字号），
		// border-radius 直接裁剪背景为圆形（不用 background-clip，会被裁成方块）
		// matchedLen：该圆点对应匹配文本的长度，点击时用于定位番号文本起点
		const buildDot = (code: string, matchedLen: number): HTMLElement => {
			const dot = document.createElement("span");
			dot.className = "javcode-dot";
			dot.title = code;
			dot.style.cssText = [
				"display:inline-block !important",
				"width:0.4em !important",
				"height:0.4em !important",
				"border:0.3em solid transparent !important",
				"border-radius:50% !important",
				"background-color:#f59e0b !important",
				"margin-left:0.2em !important",
				"vertical-align:middle !important",
				"line-height:0 !important",
				"cursor:pointer !important",
				"box-sizing:content-box !important",
				"transition:background-color 0.12s ease,box-shadow 0.12s ease !important",
			].join(";");
			// hover 用 JS 控制：不依赖注入 style 标签的 :hover 规则；移出恢复金色
			dot.addEventListener("mouseenter", () => {
				dot.style.setProperty("background-color", "#fbbf24", "important");
				dot.style.setProperty(
					"box-shadow",
					"0 0 6px rgba(245,158,11,0.9)",
					"important",
				);
			});
			dot.addEventListener("mouseleave", () => {
				dot.style.setProperty("background-color", "#f59e0b", "important");
				dot.style.setProperty("box-shadow", "none", "important");
			});
			dot.addEventListener("click", (event) => {
				// 圆点常落在链接文本内，阻止冒泡防跳转
				event.preventDefault();
				event.stopPropagation();

				// 与面板点击番号一致：金底黑字只属于当前预览的番号。
				// 先清理页面上所有旧标记，再就地包裹本处番号，保证页面仅一个 badge。
				document.querySelectorAll(".javcode-locate-badge").forEach((el) => {
					const parent = el.parentNode;
					if (parent) {
						while (el.firstChild) {
							parent.insertBefore(el.firstChild, el);
						}
						parent.removeChild(el);
						parent.normalize();
					}
				});

				// 不做滚动定位，就地高亮该处番号为金底黑字（与定位标记同款静态样式）。
				// splitText 保证 dot 的前一个兄弟节点是以番号结尾的文本节点，
				// 番号 = 该节点末尾 matchedLen 个字符；已高亮（兄弟变为 mark 元素）则跳过。
				const prev = dot.previousSibling;
				if (prev && prev.nodeType === 3) {
					try {
						const start = Math.max(0, (prev.nodeValue ?? "").length - matchedLen);
						const range = document.createRange();
						range.setStart(prev, start);
						range.setEnd(prev, prev.nodeValue?.length ?? 0);
						const mark = document.createElement("mark");
						mark.className = "javcode-locate-badge";
						mark.style.cssText = [
							"background:#f59e0b !important",
							"color:#000000 !important",
							"font-weight:800 !important",
							"padding:2px 6px !important",
							"border-radius:4px !important",
							"display:inline-block !important",
							"line-height:1.2 !important",
							"vertical-align:baseline !important",
						].join(";");
						range.surroundContents(mark);
					} catch {
						// 包裹失败（跨节点等极端情况）不影响打开预览
					}
				}

				const host =
					(globalThis as typeof globalThis & {
						chrome?: { runtime?: { sendMessage?: (msg: unknown) => void } };
						browser?: { runtime?: { sendMessage?: (msg: unknown) => void } };
					});
				const send =
					host.chrome?.runtime?.sendMessage ??
					host.browser?.runtime?.sendMessage;
				if (typeof send === "function") {
					try {
						send({ type: "jt:code-clicked", code });
					} catch {
						// 扩展上下文失效（如面板关闭瞬间）忽略
					}
				}
			});
			return dot;
		};

		const walker = document.createTreeWalker(
			document.body,
			NodeFilter.SHOW_TEXT,
			{
				acceptNode(node) {
					const parent = node.parentElement;
					if (!parent) return NodeFilter.FILTER_REJECT;
					const tag = parent.tagName.toUpperCase();
					if (
						tag === "SCRIPT" ||
						tag === "STYLE" ||
						tag === "NOSCRIPT" ||
						tag === "TEXTAREA" ||
						tag === "INPUT"
					) {
						return NodeFilter.FILTER_REJECT;
					}
					if (!isElementVisible(parent)) {
						return NodeFilter.FILTER_REJECT;
					}
					return NodeFilter.FILTER_ACCEPT;
				},
			},
		);

		let currentNode: Node | null = walker.nextNode();

		while (currentNode) {
			const text = currentNode.nodeValue || "";
			if (text.trim()) {
				// 收集该文本节点内所有匹配（code、结束位置、实际匹配文本长度），再统一插入
				const found: Array<{ end: number; code: string; matchedLen: number }> =
					[];
				for (const { chunk, regex } of chunkedRegexes) {
					regex.lastIndex = 0;
					let match: RegExpExecArray | null;
					while ((match = regex.exec(text)) !== null) {
						// 捕获组下标 1..N 反查命中候选
						for (let g = 1; g <= chunk.length; g++) {
							if (match[g] === undefined) continue;
							// g 在 1..chunk.length 内，chunk[g-1] 必然存在
							const code = chunk[g - 1]!;
							const key = code.toUpperCase();
							if ((counts.get(key) ?? 0) < perCodeLimit) {
								counts.set(key, (counts.get(key) ?? 0) + 1);
								found.push({
									end: match.index + match[0].length,
									code,
									matchedLen: match[0].length,
								});
							}
							break;
						}
						// 防零宽匹配死循环
						if (match.index === regex.lastIndex) regex.lastIndex++;
					}
				}

				// 从后往前 splitText 插入，保证前面的匹配索引不受影响
				found.sort((a, b) => b.end - a.end);
				for (const f of found) {
					// TreeWalker 收集的是文本节点，splitText 仅在 Text 上存在
					const after = (currentNode as Text).splitText(f.end);
					const dot = buildDot(f.code, f.matchedLen);
					currentNode.parentNode?.insertBefore(dot, after);
				}
			}
			currentNode = walker.nextNode();
		}
	} catch {
		// 页面 DOM 异常时不阻塞面板流程
	}
}

/**
 * 在指定标签页执行 markCodesInTab（面板扫描成功后调用；codes 为空时仅清理旧标记）。
 */
export async function markCodesForTab(
	tabId: number,
	codes: string[],
	perCodeLimit = 30,
): Promise<void> {
	try {
		await browser.scripting.executeScript({
			target: { tabId },
			func: markCodesInTab,
			args: [codes, perCodeLimit],
		});
	} catch (err) {
		console.warn("Failed to mark codes in tab:", tabId, err);
	}
}

/**
 * 在指定标签页清理圆点标记（面板关闭时由 background 调用）。
 */
export async function clearCodeMarksForTab(tabId: number): Promise<void> {
	try {
		await browser.scripting.executeScript({
			target: { tabId },
			func: clearCodeMarksInTab,
		});
	} catch (err) {
		console.warn("Failed to clear code marks in tab:", tabId, err);
	}
}
