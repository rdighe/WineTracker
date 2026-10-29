/**
 * Photos and PDFs shared to the app from another app's share sheet
 * (expo-share-intent), held for the picks screen to read as a wine list or
 * a shelf. Taken once.
 */
import { Image } from 'react-native';

export interface SharedFile { uri: string; mimeType: string; width: number | null; height: number | null }

let waiting: SharedFile[] = [];

export function holdSharedFiles(files: SharedFile[]): void {
  waiting = files;
}

export function takeSharedFiles(): SharedFile[] {
  const files = waiting;
  waiting = [];
  return files;
}

export const isPdf = (f: Pick<SharedFile, 'mimeType' | 'uri'>) => f.mimeType === 'application/pdf' || /\.pdf$/i.test(f.uri);
export const isImage = (f: Pick<SharedFile, 'mimeType'>) => f.mimeType.startsWith('image/');

/** A shared photo's size, when the share didn't say. */
export async function withSize(f: SharedFile): Promise<{ uri: string; width: number; height: number }> {
  if (f.width && f.height) return { uri: f.uri, width: f.width, height: f.height };
  const { width, height } = await Image.getSize(f.uri);
  return { uri: f.uri, width, height };
}
