import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { AppEnv } from "../config/env.js";
import { parseInvoicePdf } from "../agent/pdf-parse.js";
import { normalizeAmount } from "../utils/amount.js";
import { OpenRouterService } from "./openrouter.js";
import { LarkApiService } from "../lark/api.js";

type ParsedImage = {
  filePath: string;
  amount: number;
};

type ParsedPdf = {
  filePath: string;
  amount: number;
  date?: string;
};

export type BatchArchiveReport = {
  matchedCount: number;
  unmatchedImages: string[];
  unmatchedPdfs: string[];
};

export class BatchArchiver {
  private readonly llm: OpenRouterService;

  constructor(
    private readonly env: AppEnv,
    private readonly larkApi: LarkApiService
  ) {
    this.llm = new OpenRouterService({
      apiKey: env.OPENROUTER_API_KEY,
      model: env.OPENROUTER_VLM_MODEL
    });
  }

  async run(directory: string): Promise<BatchArchiveReport> {
    if (!this.env.LARK_BASE_TOKEN || !this.env.LARK_TABLE_ID) {
      throw new Error("缺少 LARK_BASE_TOKEN / LARK_TABLE_ID，请先完成初始化");
    }

    const files = await this.collectFiles(directory);
    const imageFiles = files.filter((f) => isImageFile(f));
    const pdfFiles = files.filter((f) => f.toLowerCase().endsWith(".pdf"));

    const parsedImages = await this.parseImages(imageFiles);
    const parsedPdfs = await this.parsePdfs(pdfFiles);

    const pdfBuckets = new Map<number, ParsedPdf[]>();
    for (const pdf of parsedPdfs) {
      const key = toCents(pdf.amount);
      const queue = pdfBuckets.get(key) ?? [];
      queue.push(pdf);
      pdfBuckets.set(key, queue);
    }

    let matchedCount = 0;
    const unmatchedImages: string[] = [];

    for (const image of parsedImages) {
      const key = toCents(image.amount);
      const queue = pdfBuckets.get(key);
      if (!queue || queue.length === 0) {
        unmatchedImages.push(path.basename(image.filePath));
        continue;
      }
      const pdf = queue.shift()!;
      await this.archivePair(image, pdf);
      matchedCount += 1;
    }

    const unmatchedPdfs: string[] = [];
    for (const queue of pdfBuckets.values()) {
      for (const pdf of queue) {
        unmatchedPdfs.push(path.basename(pdf.filePath));
      }
    }

    return {
      matchedCount,
      unmatchedImages,
      unmatchedPdfs
    };
  }

  private async archivePair(image: ParsedImage, pdf: ParsedPdf): Promise<void> {
    const imageBuffer = await readFile(image.filePath);
    const pdfBuffer = await readFile(pdf.filePath);

    const imageToken = await this.larkApi.uploadToBitableMedia(
      this.env.LARK_BASE_TOKEN!,
      path.basename(image.filePath),
      imageBuffer,
      "image/jpeg"
    );
    const pdfToken = await this.larkApi.uploadToBitableMedia(
      this.env.LARK_BASE_TOKEN!,
      path.basename(pdf.filePath),
      pdfBuffer,
      "application/pdf"
    );

    await this.larkApi.createAccountingRecord(this.env.LARK_BASE_TOKEN!, this.env.LARK_TABLE_ID!, {
      amount: pdf.amount,
      screenshotFileToken: imageToken,
      invoiceFileToken: pdfToken,
      date: pdf.date
    });
  }

  private async parseImages(files: string[]): Promise<ParsedImage[]> {
    const result: ParsedImage[] = [];
    for (const filePath of files) {
      const buffer = await readFile(filePath);
      const amount = await this.llm.extractPaidAmountFromImage(buffer, guessImageMimeType(filePath));
      result.push({ filePath, amount: normalizeAmount(amount) });
    }
    return result;
  }

  private async parsePdfs(files: string[]): Promise<ParsedPdf[]> {
    const result: ParsedPdf[] = [];
    for (const filePath of files) {
      const buffer = await readFile(filePath);
      const parsed = await parseInvoicePdf(buffer);
      result.push({
        filePath,
        amount: normalizeAmount(parsed.amount),
        date: parsed.date
      });
    }
    return result;
  }

  private async collectFiles(root: string): Promise<string[]> {
    const nodes = await readdir(root);
    const all: string[] = [];
    for (const name of nodes) {
      const fullPath = path.join(root, name);
      const s = await stat(fullPath);
      if (s.isDirectory()) {
        const nested = await this.collectFiles(fullPath);
        all.push(...nested);
      } else if (s.isFile()) {
        all.push(fullPath);
      }
    }
    return all;
  }
}

function toCents(amount: number): number {
  return Math.round(normalizeAmount(amount) * 100);
}

function isImageFile(file: string): boolean {
  const lower = file.toLowerCase();
  return lower.endsWith(".jpg") || lower.endsWith(".jpeg") || lower.endsWith(".png") || lower.endsWith(".webp");
}

function guessImageMimeType(filePath: string): string {
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  return "image/jpeg";
}
