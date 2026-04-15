// Shared helper for persisting an ATF form scan into
// documentDirectory/atf_forms/. Used by both the manual AtfFormSection
// "attach" flow and the OCR scanners in add/edit-firearm / suppressor,
// so a single on-device copy serves the slot, the OCR extraction, and
// backup round-tripping.

import { File, Directory, Paths } from 'expo-file-system';

/**
 * Copy an image at `uri` into the app's atf_forms directory and return
 * the stored path (relative to documentDirectory) so it can live in
 * atf_form_front_uri / atf_form_back_uri columns alongside other images.
 */
export async function saveScanToAtfForms(uri: string): Promise<string> {
  const dir = new Directory(Paths.document, 'atf_forms');
  if (!dir.exists) dir.create();
  const ext = uri.split('.').pop()?.toLowerCase() || 'jpg';
  const filename = `atf_${Date.now()}.${ext}`;
  const source = new File(uri);
  const dest = new File(dir, filename);
  source.copy(dest);
  return 'atf_forms/' + filename;
}
