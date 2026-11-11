// The studio's video encode settings in one place (STUDIO FINISH c1, 1 Oct). render.mjs and finish_ab.mjs import
// them; the shell scripts (local_render.sh, farm_job.sh, reclose.sh, remux_audio.sh, finish.sh) carry the same
// strings, so change them together. `node web/enc_args.mjs master|color|to709` prints one set as JSON.
//
// Why:
// - Colour. Our frames are sRGB pictures. Before 1 Oct they reached x264 as JPEG (BT.601 YCbCr) with no colour
//   tags, so the files were BT.601 and untagged; every phone, browser and platform decodes untagged HD video as
//   BT.709, and the house red D11F24 played as 225,49,32 (orange), gold and maroon shifted too. Now the RGB grab is
//   converted with the BT.709 matrix to limited range and tagged 709/709/709, which is what every player expects.
//   TO709 also converts an old untagged (601) master correctly when a script re-encodes it (in_color_matrix=auto
//   reads an untagged input as 601), and is a no-op on a 709 input.
// - Generations. The grab is lossless (PNG, not JPEG q93 4:2:0) and the master is the only x264 generation before
//   the share copy (local_render / farm_job now trim by stream copy instead of a second crf 18 encode), so the
//   master's crf can be lower for the same end size.
export const COLOR = ['-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv'];
export const TO709 = 'scale=in_color_matrix=auto:out_color_matrix=bt709:out_range=tv:flags=lanczos+accurate_rnd+full_chroma_int';
export const MASTER_CRF = 16;
export function master(crf = MASTER_CRF) {
  return ['-vf', `${TO709},format=yuv420p`, '-c:v', 'libx264', '-preset', 'slow', '-crf', String(crf), '-pix_fmt', 'yuv420p',
    '-profile:v', 'high', ...COLOR];
}
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  const k = process.argv[2] || 'master';
  console.log(JSON.stringify(k === 'color' ? COLOR : k === 'to709' ? TO709 : master()));
}
