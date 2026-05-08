/** Chrome / Edge (Chromium): pick a folder and write files without using the default Downloads location. */

export type WindowWithDirectoryPicker = Window & {
  showDirectoryPicker?: (options?: { mode?: 'read' | 'readwrite' }) => Promise<FileSystemDirectoryHandle>;
};

export function canSaveWatchlistToChosenFolder(): boolean {
  if (typeof window === 'undefined') return false;
  return typeof (window as WindowWithDirectoryPicker).showDirectoryPicker === 'function';
}

export async function writeBlobToChosenDirectory(
  directoryHandle: FileSystemDirectoryHandle,
  filename: string,
  blob: Blob
): Promise<void> {
  const safeName = filename.replace(/^[/\\]+/, '').replace(/\0/g, '');
  if (!safeName) throw new Error('Invalid file name.');
  const fileHandle = await directoryHandle.getFileHandle(safeName, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(blob);
  await writable.close();
}
