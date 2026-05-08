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

/** Decode any audio blob to an AudioBuffer via the Web Audio API. */
export async function decodeBlob(blob: Blob): Promise<AudioBuffer> {
  const arrayBuffer = await blob.arrayBuffer();
  const ctx = new AudioContext();
  const buffer = await ctx.decodeAudioData(arrayBuffer);
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
  // Step 1: fetch all blobs
  const blobs: Blob[] = [];
  for (let i = 0; i < items.length; i++) {
    blobs.push(await apiClient.exportGenerationAudio(items[i].id));
    onProgress?.(i + 1, items.length);
  }

  // Step 2: decode + resample to first file's sample rate
  const audioBuffers = await Promise.all(blobs.map(decodeBlob));
  const targetRate = audioBuffers[0].sampleRate;
  const resampled = await Promise.all(audioBuffers.map((b) => resampleBuffer(b, targetRate)));

  // Step 3: concatenate PCM channels
  const totalLen = resampled.reduce((s, b) => s + b.length, 0);
  const mergedLeft = new Float32Array(totalLen);
  const hasStereo = resampled.some((b) => b.numberOfChannels > 1);
  const mergedRight = hasStereo ? new Float32Array(totalLen) : null;
  let off = 0;
  for (const b of resampled) {
    mergedLeft.set(b.getChannelData(0), off);
    if (mergedRight) {
      mergedRight.set(
        b.numberOfChannels > 1 ? b.getChannelData(1) : b.getChannelData(0),
        off,
      );
    }
    off += b.length;
  }

  // Step 4: encode and prompt the user to pick a save location
  const ext = format === 'mp3' ? 'mp3' : 'wav';
  let fileBytes: Uint8Array;
  if (format === 'mp3') {
    fileBytes = await encodePcmToMp3(mergedLeft, mergedRight, targetRate);
  } else {
    fileBytes = encodeAsWav(mergedLeft, mergedRight, targetRate);
  }

  await saveFile(
    `joined.${ext}`,
    new Blob([fileBytes.buffer as ArrayBuffer]),
    [{ name: format === 'mp3' ? 'MP3 Audio' : 'WAV Audio', extensions: [ext] }],
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
    onProgress?.(i + 1, items.length);
  }

  return dir;
}
