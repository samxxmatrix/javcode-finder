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
 * 在每个已识别番号的页面匹配文本末尾插入金色实心小圆点；命中收藏（favoriteCodes）的
 * 番号替换为金色书签图标。点击只发消息 jt:code-clicked 给面板打开预告片预览（不做定位）。
 */
export function markCodesInTab(
	codes: string[],
	perCodeLimit = 30,
	favoriteCodes?: string[],
): void {
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

		// 收藏集合（大写比较，与面板收藏去重口径一致）
		const favSet = new Set<string>();
		if (favoriteCodes) {
			for (const f of favoriteCodes) {
				const key = String(f).trim().toUpperCase();
				if (key) favSet.add(key);
			}
		}

		// 标记统一用 SVG（普通番号金色实心圆、收藏番号金色书签），容器样式与
		// hover 行为完全一致：尺寸随字号（em），hover 用 drop-shadow 沿图形轮廓发光，
		// 避免 background/box-shadow 在 SVG 图标上产生色块等异常。
		// matchedLen：该标记对应匹配文本的长度，点击时用于定位番号文本起点
		const buildDot = (
			code: string,
			matchedLen: number,
			isFav: boolean,
		): HTMLElement => {
			const dot = document.createElement("span");
			dot.className = isFav ? "javcode-dot javcode-dot--fav" : "javcode-dot";
			dot.title = code;
			dot.style.cssText = [
				"display:inline-block !important",
				"padding:0.3em !important",
				"margin-right:0.2em !important",
				"vertical-align:middle !important",
				"line-height:0 !important",
				"cursor:pointer !important",
			].join(";");
			dot.innerHTML = isFav
				? // 金色书签：与面板收藏图标同款 path
					'<svg viewBox="0 0 1024 1024" width="1em" height="1em"><path d="M832.8 63.9H191.2c-17.8 0-32.3 14.5-32.3 32.3V878c0 23.3 23.9 38.9 45.3 29.6L489.8 782l331.4 128.4c21.2 8.2 44-7.4 44-30.1V96.2c-0.1-17.9-14.5-32.3-32.4-32.3z" fill="#f59e0b"/></svg>'
				: // 金色实心圆：尺寸与书签一致（1em）
					'<svg viewBox="0 0 16 16" width="1em" height="1em"><circle cx="8" cy="8" r="8" fill="#f59e0b"/></svg>';
			// hover 用 JS 控制：drop-shadow 沿 SVG 轮廓发光，圆点与书签行为统一
			dot.addEventListener("mouseenter", () => {
				dot.style.setProperty(
					"filter",
					"drop-shadow(0 0 0.15em rgba(245,158,11,0.9))",
					"important",
				);
			});
			dot.addEventListener("mouseleave", () => {
				dot.style.setProperty("filter", "none", "important");
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
				// splitText 保证 dot 的后一个兄弟节点是以番号开头的文本节点，
				// 番号 = 该节点开头 matchedLen 个字符；已高亮（兄弟变为 mark 元素）则跳过。
				const next = dot.nextSibling;
				if (next && next.nodeType === 3) {
					try {
						const range = document.createRange();
						range.setStart(next, 0);
						range.setEnd(next, matchedLen);
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
			// 跳过紧随标识之后的番号文本节点：它已被标记，再匹配会重复插入
			const prevEl = currentNode.previousSibling as HTMLElement | null;
			if (
				prevEl &&
				typeof prevEl.className === "string" &&
				prevEl.className.includes("javcode-dot")
			) {
				currentNode = walker.nextNode();
				continue;
			}
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

				// 从后往前 splitText 插入，保证前面的匹配索引不受影响。
				// 标识放在番号之前（侧面板挤压页面宽度时行尾标识可能被挤出可视区）；
				// 番号单独切出独立节点，避免 TreeWalker 重复匹配同一处
				found.sort((a, b) => b.end - a.end);
				for (const f of found) {
					// TreeWalker 收集的是文本节点，splitText 仅在 Text 上存在。
					// splitText 返回后半段、原节点保留前半段：
					// 第一次在匹配起点截断，后半段以番号开头；
					// 第二次按匹配长度截断，原对象精确为番号文本，返回值是番号后剩余
					const start = f.end - f.matchedLen;
					const codeNode = (currentNode as Text).splitText(start);
					codeNode.splitText(f.matchedLen);
					const dot = buildDot(
						f.code,
						f.matchedLen,
						favSet.has(f.code.toUpperCase()),
					);
					// 最终结构：原节点 | dot | 番号节点 | 番号后剩余
					currentNode.parentNode?.insertBefore(dot, codeNode);
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
	favoriteCodes?: string[],
): Promise<void> {
	try {
		await browser.scripting.executeScript({
			target: { tabId },
			func: markCodesInTab,
			args: [codes, perCodeLimit, favoriteCodes],
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
