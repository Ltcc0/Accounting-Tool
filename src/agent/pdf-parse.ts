import pdfParse from "pdf-parse";
import dayjs from "dayjs";
import { extractAmountCandidates, normalizeAmount } from "../utils/amount.js";

export type ParsedInvoice = {
  amount: number;
  date?: string;
  rawText: string;
};

export async function parseInvoicePdf(buffer: Buffer): Promise<ParsedInvoice> {
  const result = await pdfParse(buffer);
  const text = result.text || "";
  const amounts = extractAmountCandidates(text).sort((a, b) => b - a);
  if (!amounts.length) {
    throw new Error("未在 PDF 中识别到金额");
  }

  const date = extractDate(text);
  return {
    amount: normalizeAmount(amounts[0]),
    date,
    rawText: text
  };
}

function extractDate(input: string): string | undefined {
  const yyyyMmDd = input.match(/(20\d{2})[\/\-.年]\s*(\d{1,2})[\/\-.月]\s*(\d{1,2})/);
  if (!yyyyMmDd) return undefined;
  const [, y, m, d] = yyyyMmDd;
  const value = dayjs(`${y}-${m}-${d}`);
  return value.isValid() ? value.format("YYYY-MM-DD") : undefined;
}

