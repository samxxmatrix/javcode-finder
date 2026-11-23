import { useEffect } from "react";

/**
 * 可复用的确认弹窗：替代 window.confirm，复用扩展侧已有 confirm-overlay / confirm-dialog 样式。
 */
export type ConfirmVariant = "primary" | "secondary" | "danger";

interface ConfirmDialogProps {
	open: boolean;
	title: string;
	confirmLabel?: string;
	cancelLabel?: string;
	confirmVariant?: ConfirmVariant;
	onConfirm: () => void;
	onCancel: () => void;
	children?: React.ReactNode;
}

export function ConfirmDialog({
	open,
	title,
	confirmLabel = "确认",
	cancelLabel = "取消",
	confirmVariant = "primary",
	onConfirm,
	onCancel,
	children,
}: ConfirmDialogProps) {
	// 弹窗打开时禁用页面滚动，关闭后恢复
	useEffect(() => {
		if (!open) return;
		document.body.style.overflow = "hidden";
		return () => {
			document.body.style.overflow = "";
		};
	}, [open]);

	if (!open) return null;

	return (
		<div className="confirm-overlay" role="dialog" aria-modal="true" aria-label={title}>
			<div className="confirm-dialog">
				<p className="confirm-dialog__text">{title}</p>
				{children}
				<div className="confirm-dialog__actions">
					<button
						type="button"
						className={`popup-btn popup-btn--secondary`}
						onClick={onCancel}
					>
						{cancelLabel}
					</button>
					<button
						type="button"
						className={`popup-btn popup-btn--${confirmVariant}`}
						onClick={onConfirm}
					>
						{confirmLabel}
					</button>
				</div>
			</div>
		</div>
	);
}
