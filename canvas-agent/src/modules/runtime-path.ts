import path from "node:path";

export function resolveRuntimePath(value: string) {
    const configured = value.trim();
    if (path.isAbsolute(configured) || path.win32.isAbsolute(configured)) return configured;
    return path.resolve(configured);
}
