export interface DestroyableInstance {
	destroy(): void;
}

export function destroyHlsInstance<T extends DestroyableInstance>(
	ref: { current: T | null },
): void {
	ref.current?.destroy();
	ref.current = null;
}
