/**
 * audioExport.ts
 *
 * Pure utility functions for audio export:
 *  - PCM decoding / resampling
 *  - WAV encoding
 *  - MP3 encoding (via @breezystack/lamejs)
 *  - joinExport  — concatenate all clips → single file via save dialog
 *  - splitExport — write one numbered file per clip into a chosen folder
 */

import { apiClient } from '@/lib/api/client';

// ─── Types ───────────────────────────────────────────────────────────────────

export type ExportFormat = 'wav' | 'mp3';

export type ProgressCallback = (current: number, total: number) => void;

// ─── PCM helpers ─────────────────────────────────────────────────────────────

/**
 * Read the sample rate from a WAV/RIFF header without fully decoding the file.
 * Returns null if the buffer is not a valid WAV file.
 * WAV fmt chunk layout: "RIFF" @ 0, "WAVE" @ 8, "fmt " @ 12,
 * sample rate as a uint32-LE @ offset 24.
 */
function readWavSampleRate(buffer: ArrayBuffer): number | null {
  if (buffer.byteLength < 44) return null;
  const view = new DataView(buffer);
  const riff = String.fromCharCode(
    view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3),
  );
  if (riff !== 'RIFF') return null;
  return view.getUint32(24, true); // sample rate field in fmt chunk
}

/**
 * Decode any audio blob to an AudioBuffer via the Web Audio API.
 *
 * We create the AudioContext at the file's *native* sample rate (read from the
 * WAV header) so that decodeAudioData does NOT silently upsample the audio to
 * the system output rate (48000 Hz on Windows). Without this, every 22050 Hz
 * clip from the model would appear as 48000 Hz and the joined file would be
 * encoded at the wrong rate with 2× the required memory.
 */
export async function decodeBlob(blob: Blob): Promise<AudioBuffer> {
  const arrayBuffer = await blob.arrayBuffer();
  const nativeRate = readWavSampleRate(arrayBuffer) ?? undefined;
  const ctx = new AudioContext(nativeRate ? { sampleRate: nativeRate } : undefined);
  const buffer = await ctx.decodeAudioData(arrayBuffer.slice(0)); // slice avoids detached-buffer issues
  await ctx.close();
  return buffer;
}

/** Resample an AudioBuffer to a target sample rate using OfflineAudioContext. */
export async function resampleBuffer(
  buffer: AudioBuffer,
  targetSampleRate: number,
): Promise<AudioBuffer> {
  if (buffer.sampleRate === targetSampleRate) return buffer;
  const offlineCtx = new OfflineAudioContext(
    buffer.numberOfChannels,
    Math.ceil(buffer.duration * targetSampleRate),
    targetSampleRate,
  );
  const src = offlineCtx.createBufferSource();
  src.buffer = buffer;
  src.connect(offlineCtx.destination);
  src.start(0);
  return offlineCtx.startRendering();
}

/** Encode float32 PCM to a 16-bit little-endian WAV Uint8Array. */
export function encodeAsWav(
  left: Float32Array,
  right: Float32Array | null,
  sampleRate: number,
): Uint8Array {
  const numChannels = right ? 2 : 1;
  const dataSize = left.length * numChannels * 2;
  const buf = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buf);
  const ws = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
  };
  ws(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  ws(8, 'WAVE');
  ws(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numChannels * 2, true);
  view.setUint16(32, numChannels * 2, true);
  view.setUint16(34, 16, true);
  ws(36, 'data');
  view.setUint32(40, dataSize, true);
  let off = 44;
  const clip = (v: number) => Math.max(-1, Math.min(1, v));
  for (let i = 0; i < left.length; i++) {
    const l = clip(left[i]);
    view.setInt16(off, l < 0 ? l * 0x8000 : l * 0x7fff, true);
    off += 2;
    if (right) {
      const r = clip(right[i]);
      view.setInt16(off, r < 0 ? r * 0x8000 : r * 0x7fff, true);
      off += 2;
    }
  }
  return new Uint8Array(buf);
}

/** Encode float32 PCM to an MP3 Uint8Array at 128 kbps via @breezystack/lamejs. */
export async function encodePcmToMp3(
  left: Float32Array,
  right: Float32Array | null,
  sampleRate: number,
): Promise<Uint8Array> {
  const { Mp3Encoder } = await import('@breezystack/lamejs');
  const numChannels = (right ? 2 : 1) as 1 | 2;
  const encoder = new Mp3Encoder(numChannels, sampleRate, 128);

  const toInt16 = (f: Float32Array): Int16Array => {
    const i16 = new Int16Array(f.length);
    for (let i = 0; i < f.length; i++) {
      const s = Math.max(-1, Math.min(1, f[i]));
      i16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    return i16;
  };

  const lI16 = toInt16(left);
  const rI16 = right ? toInt16(right) : lI16;
  const chunkSize = 1152;
  const chunks: Uint8Array[] = [];

  for (let i = 0; i < lI16.length; i += chunkSize) {
    const lChunk = lI16.subarray(i, i + chunkSize);
    const rChunk = rI16.subarray(i, i + chunkSize);
    const enc =
      numChannels === 2 ? encoder.encodeBuffer(lChunk, rChunk) : encoder.encodeBuffer(lChunk);
    if (enc.length > 0) chunks.push(new Uint8Array(enc));
  }
  const flushed = encoder.flush();
  if (flushed.length > 0) chunks.push(new Uint8Array(flushed));

  const total = chunks.reduce((s, c) => s + c.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

/** Decode a single WAV blob and re-encode to MP3 (used in split export). */
export async function encodeWavBlobToMp3(wavBlob: Blob): Promise<Uint8Array> {
  const buf = await decodeBlob(wavBlob);
  const left = buf.getChannelData(0);
  const right = buf.numberOfChannels > 1 ? buf.getChannelData(1) : null;
  return encodePcmToMp3(left, right, buf.sampleRate);
}

// ─── JOIN MODE ───────────────────────────────────────────────────────────────

/**
 * Fetch all generation audio blobs, concatenate their PCM, encode to the
 * requested format, and open the native save-file dialog.
 *
 * @param items       Generation IDs to export.
 * @param format      'wav' | 'mp3'
 * @param saveFile    Platform save-file function (from usePlatform).
 * @param onProgress  Called after each blob is fetched.
 */
export async function joinExport(
  items: Array<{ id: string }>,
  format: ExportFormat,
  saveFile: (name: string, blob: Blob, filters: { name: string; extensions: string[] }[]) => Promise<void>,
  onProgress?: ProgressCallback,
): Promise<void> {
  if (format === 'mp3') {
    await joinExportMp3(items, saveFile, onProgress);
  } else {
    await joinExportWav(items, saveFile, onProgress);
  }
}

/**
 * MP3 JOIN: encode each clip to compressed MP3 bytes immediately, then
 * concatenate the byte arrays. MP3 is a frame-based format — concatenating
 * individually encoded clips produces a valid MP3 file.
 *
 * Peak memory ≈ one clip's PCM + accumulated compressed output (~16 KB/s at
 * 128 kbps), vs. the old approach which held ALL clips' float32 PCM at once
 * (170 clips × 30 s × 24 kHz × 4 bytes ≈ 490 MB before even encoding).
 */
async function joinExportMp3(
  items: Array<{ id: string }>,
  saveFile: (name: string, blob: Blob, filters: { name: string; extensions: string[] }[]) => Promise<void>,
  onProgress?: ProgressCallback,
): Promise<void> {
  let targetRate: number | null = null;
  // Each element is one clip's worth of compressed MP3 frames (~16 KB/s).
  // For 170 × 30 s clips this totals ~82 MB — tiny compared to raw PCM.
  const mp3Parts: Uint8Array[] = [];

  for (let i = 0; i < items.length; i++) {
    const blob = await apiClient.exportGenerationAudio(items[i].id);
    let audioBuf = await decodeBlob(blob);

    if (targetRate === null) targetRate = audioBuf.sampleRate;
    audioBuf = await resampleBuffer(audioBuf, targetRate);

    // Encode this clip's PCM to MP3 frames immediately — the AudioBuffer
    // and its internal PCM arrays are released after this call.
    const left = audioBuf.getChannelData(0);
    const right = audioBuf.numberOfChannels > 1 ? audioBuf.getChannelData(1) : null;
    const mp3Bytes = await encodePcmToMp3(left, right, audioBuf.sampleRate);
    mp3Parts.push(mp3Bytes);

    onProgress?.(i + 1, items.length);
  }

  if (!mp3Parts.length) return;

  // Concatenate the small MP3 frame arrays into one output buffer
  const totalBytes = mp3Parts.reduce((s, c) => s + c.length, 0);
  const output = new Uint8Array(totalBytes);
  let offset = 0;
  for (const part of mp3Parts) {
    output.set(part, offset);
    offset += part.length;
  }

  await saveFile(
    'joined.mp3',
    new Blob([output.buffer as ArrayBuffer], { type: 'audio/mpeg' }),
    [{ name: 'MP3 Audio', extensions: ['mp3'] }],
  );
}

/**
 * WAV JOIN: resample all clips to the first clip's sample rate, accumulate
 * PCM Float32 slices one at a time (releasing each AudioBuffer immediately),
 * then write a single WAV file.
 */
async function joinExportWav(
  items: Array<{ id: string }>,
  saveFile: (name: string, blob: Blob, filters: { name: string; extensions: string[] }[]) => Promise<void>,
  onProgress?: ProgressCallback,
): Promise<void> {
  let targetRate: number | null = null;
  const leftChunks: Float32Array[] = [];
  const rightChunks: Float32Array[] = [];
  let hasStereo = false;
  let totalLen = 0;

  for (let i = 0; i < items.length; i++) {
    const blob = await apiClient.exportGenerationAudio(items[i].id);
    let audioBuf = await decodeBlob(blob);

    if (targetRate === null) targetRate = audioBuf.sampleRate;
    audioBuf = await resampleBuffer(audioBuf, targetRate);

    // .slice() copies the data so the AudioBuffer itself can be GC'd
    const leftSlice = audioBuf.getChannelData(0).slice();
    const rightSlice = audioBuf.numberOfChannels > 1 ? audioBuf.getChannelData(1).slice() : null;

    leftChunks.push(leftSlice);
    rightChunks.push(rightSlice ?? leftSlice); // index-aligned placeholder
    if (rightSlice) hasStereo = true;
    totalLen += leftSlice.length;

    onProgress?.(i + 1, items.length);
  }

  if (targetRate === null) return;

  const mergedLeft = new Float32Array(totalLen);
  const mergedRight = hasStereo ? new Float32Array(totalLen) : null;
  let off = 0;
  for (let i = 0; i < leftChunks.length; i++) {
    mergedLeft.set(leftChunks[i], off);
    if (mergedRight) mergedRight.set(rightChunks[i], off);
    off += leftChunks[i].length;
  }

  const fileBytes = encodeAsWav(mergedLeft, mergedRight, targetRate);
  await saveFile(
    'joined.wav',
    new Blob([fileBytes.buffer as ArrayBuffer], { type: 'audio/wav' }),
    [{ name: 'WAV Audio', extensions: ['wav'] }],
  );
}

// ─── SPLIT MODE ──────────────────────────────────────────────────────────────

/**
 * Fetch each generation audio blob individually, encode if needed, and write
 * sequentially numbered files (01.wav, 02.mp3, …) into a chosen folder.
 *
 * @param items        Generation IDs to export.
 * @param format       'wav' | 'mp3'
 * @param pickDirectory Platform directory-picker function (from usePlatform).
 * @param onProgress   Called after each file is written.
 * @returns            The chosen directory path, or null if user cancelled.
 */
export async function splitExport(
  items: Array<{ id: string }>,
  format: ExportFormat,
  pickDirectory: (title: string) => Promise<string | null>,
  onProgress?: ProgressCallback,
): Promise<string | null> {
  const dir = await pickDirectory('Choose export folder');
  if (!dir) return null;

  const { writeFile } = await import('@tauri-apps/plugin-fs');

  for (let i = 0; i < items.length; i++) {
    const { id } = items[i];
    // Fetch, encode and write one file at a time; let each blob be GC'd after use
    const blob = await apiClient.exportGenerationAudio(id);
    const ext = format === 'mp3' ? 'mp3' : 'wav';
    const filename = String(i + 1).padStart(2, '0') + '.' + ext;
    let fileBytes: Uint8Array;
    if (format === 'mp3') {
      fileBytes = await encodeWavBlobToMp3(blob);
    } else {
      fileBytes = new Uint8Array(await blob.arrayBuffer());
    }
    await writeFile(`${dir}\\${filename}`, fileBytes);
    // Explicitly release the reference so the GC can reclaim memory
    // before we fetch the next file.
    (fileBytes as unknown) = null;
    onProgress?.(i + 1, items.length);
  }

  return dir;
}
