export interface DestroyableInstance {
	destroy(): void;
}

export function destroyHlsInstance<T extends DestroyableInstance>(
	ref: { current: T | null },
): void {
	ref.current?.destroy();
	ref.current = null;
}

export async function destroyHlsBefore<T extends DestroyableInstance, TResult>(
	ref: { current: T | null },
	action: () => Promise<TResult>,
): Promise<TResult> {
	destroyHlsInstance(ref);
	return action();
}
