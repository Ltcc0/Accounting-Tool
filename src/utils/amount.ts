export function normalizeAmount(input: number): number {
  return Number(input.toFixed(2));
}

export function amountToCents(input: number): number {
  return Math.round(normalizeAmount(input) * 100);
}

export function extractAmountCandidates(text: string): number[] {
  const pattern = /(?:¥|￥|RMB)?\s*([0-9]{1,6}(?:\.[0-9]{1,2})?)/gi;
  const found: number[] = [];
  for (const match of text.matchAll(pattern)) {
    const num = Number(match[1]);
    if (!Number.isNaN(num) && num > 0) {
      found.push(normalizeAmount(num));
    }
  }
  return found;
}

