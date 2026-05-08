import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api/client';
import type { HistoryQuery } from '@/lib/api/types';
import { usePlatform } from '@/platform/PlatformContext';


export function useHistory(query?: HistoryQuery) {
  return useQuery({
    queryKey: ['history', query],
    queryFn: () => apiClient.listHistory(query),
  });
}

export function useGenerationDetail(generationId: string) {
  return useQuery({
    queryKey: ['history', generationId],
    queryFn: () => apiClient.getGeneration(generationId),
    enabled: !!generationId,
  });
}

export function useDeleteGeneration() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (generationId: string) => apiClient.deleteGeneration(generationId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['history'] });
    },
  });
}

export function useClearFailedGenerations() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => apiClient.clearFailedGenerations(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['history'] });
    },
  });
}

export function useExportGeneration() {
  const platform = usePlatform();

  return useMutation({
    mutationFn: async ({ generationId, text }: { generationId: string; text: string }) => {
      const blob = await apiClient.exportGeneration(generationId);

      // Create safe filename from text
      const safeText = text
        .substring(0, 30)
        .replace(/[^a-z0-9]/gi, '-')
        .toLowerCase();
      const filename = `generation-${safeText}.voicebox.zip`;

      await platform.filesystem.saveFile(filename, blob, [
        {
          name: 'Voicebox Generation',
          extensions: ['zip'],
        },
      ]);

      return blob;
    },
  });
}

export function useExportGenerationAudio() {
  const platform = usePlatform();

  return useMutation({
    mutationFn: async ({ generationId, text }: { generationId: string; text: string }) => {
      const blob = await apiClient.exportGenerationAudio(generationId);

      // Create safe filename from text
      const safeText = text
        .substring(0, 30)
        .replace(/[^a-z0-9]/gi, '-')
        .toLowerCase();
      const filename = `${safeText}.wav`;

      await platform.filesystem.saveFile(filename, blob, [
        {
          name: 'Audio File',
          extensions: ['wav'],
        },
      ]);

      return blob;
    },
  });
}

export function useImportGeneration() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (file: File) => apiClient.importGeneration(file),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['history'] });
    },
  });
}

export interface ExportAllProgress {
  current: number;
  total: number;
}

export type ExportFormat = 'wav' | 'mp3';

/** Encode a stereo or mono float32 PCM array into an MP3 Uint8Array using lamejs. */
async function encodeWavToMp3(wavBlob: Blob): Promise<Uint8Array> {
  // Dynamically import lamejs to keep the bundle lean
  const { Mp3Encoder } = await import('@breezystack/lamejs');

  // Decode WAV → raw PCM via Web Audio API
  const arrayBuffer = await wavBlob.arrayBuffer();
  const audioCtx = new AudioContext();
  const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
  await audioCtx.close();

  const numChannels = Math.min(audioBuffer.numberOfChannels, 2) as 1 | 2;
  const sampleRate = audioBuffer.sampleRate;
  const kbps = 128;
  const encoder = new Mp3Encoder(numChannels, sampleRate, kbps);

  // Convert float32 [-1,1] → int16
  const toInt16 = (float32: Float32Array): Int16Array => {
    const int16 = new Int16Array(float32.length);
    for (let i = 0; i < float32.length; i++) {
      const s = Math.max(-1, Math.min(1, float32[i]));
      int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    return int16;
  };

  const leftF32 = audioBuffer.getChannelData(0);
  const rightF32 = numChannels === 2 ? audioBuffer.getChannelData(1) : leftF32;
  const leftInt16 = toInt16(leftF32);
  const rightInt16 = toInt16(rightF32);

  const chunkSize = 1152;
  const chunks: Uint8Array[] = [];

  for (let i = 0; i < leftInt16.length; i += chunkSize) {
    const leftChunk = leftInt16.subarray(i, i + chunkSize);
    const rightChunk = rightInt16.subarray(i, i + chunkSize);
    const encoded =
      numChannels === 2
        ? encoder.encodeBuffer(leftChunk, rightChunk)
        : encoder.encodeBuffer(leftChunk);
    if (encoded.length > 0) chunks.push(new Uint8Array(encoded));
  }

  const flushed = encoder.flush();
  if (flushed.length > 0) chunks.push(new Uint8Array(flushed));

  // Concatenate all chunks
  const totalLength = chunks.reduce((acc, c) => acc + c.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

export function useExportAllAudio() {
  const platform = usePlatform();
  const [isExporting, setIsExporting] = useState(false);
  const [progress, setProgress] = useState<ExportAllProgress | null>(null);

  const exportAll = async (
    items: Array<{ id: string }>,
    format: ExportFormat,
    onComplete?: (count: number) => void,
    onError?: (err: Error, index: number) => void,
  ) => {
    if (items.length === 0) return;

    // 1. Let the user pick a destination folder once
    const dir = await platform.filesystem.pickDirectory('Choose export folder');
    if (!dir) return; // user cancelled

    setIsExporting(true);
    setProgress({ current: 0, total: items.length });

    try {
      // Import Tauri writeFile — same plugin already used by saveFile
      const { writeFile } = await import('@tauri-apps/plugin-fs');

      for (let i = 0; i < items.length; i++) {
        const { id } = items[i];
        const blob = await apiClient.exportGenerationAudio(id);
        const ext = format === 'mp3' ? 'mp3' : 'wav';
        // Zero-padded sequential name: 01.wav / 01.mp3, …
        const filename = String(i + 1).padStart(2, '0') + '.' + ext;
        let fileBytes: Uint8Array;
        if (format === 'mp3') {
          fileBytes = await encodeWavToMp3(blob);
        } else {
          fileBytes = new Uint8Array(await blob.arrayBuffer());
        }
        await writeFile(`${dir}\\${filename}`, fileBytes);
        setProgress({ current: i + 1, total: items.length });
      }

      onComplete?.(items.length);
    } catch (err) {
      const index = progress?.current ?? 0;
      onError?.(err instanceof Error ? err : new Error(String(err)), index);
    } finally {
      setIsExporting(false);
      setProgress(null);
    }
  };

  return { exportAll, isExporting, progress };
}
