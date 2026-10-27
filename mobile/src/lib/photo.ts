/**
 * Shrink a label photo before upload: the longest side to MAX_SIDE px, as JPEG.
 * Plenty for reading a label, and a fraction of a full camera photo's upload
 * size and vision-model tokens.
 */
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import LabelText from '../../modules/label-text';

const MAX_SIDE = 1280;
/** A lineup photo keeps more pixels: each label is a small part of it. */
export const LINEUP_MAX_SIDE = 2400;

export async function prepareLabelPhoto(photo: { uri: string; width: number; height: number }, maxSide = MAX_SIDE): Promise<{ uri: string; base64: string; mimeType: string }> {
  const ctx = ImageManipulator.manipulate(photo.uri);
  const longest = Math.max(photo.width, photo.height);
  if (longest > maxSide) ctx.resize(photo.width >= photo.height ? { width: maxSide } : { height: maxSide });
  const image = await ctx.renderAsync();
  const saved = await image.saveAsync({ compress: 0.7, format: SaveFormat.JPEG, base64: true });
  if (!saved.base64) throw new Error('could not read the photo');
  return { uri: saved.uri, base64: saved.base64, mimeType: 'image/jpeg' };
}

/**
 * Label text read on the phone (Apple Vision), or undefined where that isn't
 * available (Expo Go, web, Android) or fails. The server can identify most
 * labels from this text alone, without its paid LLM read.
 */
export async function readLabelText(uri: string): Promise<string | undefined> {
  if (!LabelText) return undefined;
  try {
    const lines = await LabelText.recognizeTextAsync(uri);
    return lines.join('\n').trim() || undefined;
  } catch {
    return undefined;
  }
}
