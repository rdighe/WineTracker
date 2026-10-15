/**
 * Shrink a label photo before upload: the longest side to MAX_SIDE px, as JPEG.
 * Plenty for reading a label, and a fraction of a full camera photo's upload
 * size and vision-model tokens.
 */
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

const MAX_SIDE = 1280;

export async function prepareLabelPhoto(photo: { uri: string; width: number; height: number }): Promise<{ uri: string; base64: string; mimeType: string }> {
  const ctx = ImageManipulator.manipulate(photo.uri);
  const longest = Math.max(photo.width, photo.height);
  if (longest > MAX_SIDE) ctx.resize(photo.width >= photo.height ? { width: MAX_SIDE } : { height: MAX_SIDE });
  const image = await ctx.renderAsync();
  const saved = await image.saveAsync({ compress: 0.7, format: SaveFormat.JPEG, base64: true });
  if (!saved.base64) throw new Error('could not read the photo');
  return { uri: saved.uri, base64: saved.base64, mimeType: 'image/jpeg' };
}
