import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { createWorker, PSM, OEM, type Worker } from 'tesseract.js';

// The English language data ships with the repo so OCR works without downloading anything at runtime.
const ASSETS_DIR = path.resolve(__dirname, '..', '..', 'assets');
const IDLE_MS = 5 * 60 * 1000;

let workerPromise: Promise<Worker> | null = null;
let idleTimer: NodeJS.Timeout | null = null;
let queue: Promise<unknown> = Promise.resolve();

async function createOcrWorker(): Promise<Worker> {
  const hasLocalData = fs.existsSync(path.join(ASSETS_DIR, 'eng.traineddata'));
  const worker = await createWorker('eng', OEM.LSTM_ONLY, hasLocalData ? { langPath: ASSETS_DIR, gzip: false, cachePath: ASSETS_DIR } : {});
  await worker.setParameters({
    tessedit_pageseg_mode: PSM.AUTO,
    preserve_interword_spaces: '1',
  });
  return worker;
}

function getWorker(): Promise<Worker> {
  workerPromise ??= createOcrWorker().catch((err) => {
    workerPromise = null;
    throw err;
  });
  return workerPromise;
}

function scheduleIdleShutdown(): void {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(async () => {
    const pending = workerPromise;
    workerPromise = null;
    idleTimer = null;
    if (pending) await (await pending).terminate().catch(() => {});
  }, IDLE_MS);
  idleTimer.unref();
}

/** Cleans up a photo/screenshot so Tesseract reads it better: greyscale, contrast, sharpen, at least 2000px wide. */
async function preprocess(buffer: Buffer): Promise<Buffer> {
  try {
    const meta = await sharp(buffer).metadata();
    return await sharp(buffer)
      .rotate()
      .grayscale()
      .normalize()
      .sharpen()
      .resize(Math.max(meta.width ?? 0, 2000), null, { fit: 'inside', withoutEnlargement: false })
      .png()
      .toBuffer();
  } catch {
    return buffer;
  }
}

/**
 * Reads text from an image. One OCR worker is created on first use and reused, instead of starting (and
 * downloading language data for) a new engine per upload; recognitions run one at a time and the worker is
 * shut down after a few idle minutes to free memory.
 */
export function recognizeText(buffer: Buffer): Promise<string> {
  const run = async () => {
    const image = await preprocess(buffer);
    const worker = await getWorker();
    try {
      const { data } = await worker.recognize(image);
      return (data.text || '').trim();
    } finally {
      scheduleIdleShutdown();
    }
  };
  const result = queue.then(run, run);
  queue = result.catch(() => {});
  return result;
}

/** Stops the OCR worker immediately (used on shutdown and in tests). */
export async function shutdownOcr(): Promise<void> {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = null;
  const pending = workerPromise;
  workerPromise = null;
  if (pending) await (await pending).terminate().catch(() => {});
}
