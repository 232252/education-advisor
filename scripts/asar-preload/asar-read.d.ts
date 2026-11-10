export function extractAsar(archivePath: string, dest: string): void
export function archiveContains(archivePath: string, innerPath: string): boolean
export function asarEntry(filePath: string): unknown
export function splitAsar(filePath: string): { archive: string; inner: string } | null
