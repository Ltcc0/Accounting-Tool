export type PoolItemKind = "screenshot" | "invoice";

type BasePoolItem = {
  id: string;
  amount: number;
  createdAt: number;
  scopeKey: string;
  messageId?: string;
  chatId?: string;
};

export type ScreenshotItem = BasePoolItem & {
  kind: "screenshot";
  imageFileToken: string;
};

export type InvoiceItem = BasePoolItem & {
  kind: "invoice";
  pdfFileToken: string;
  invoiceDate?: string;
};

export type PoolItem = ScreenshotItem | InvoiceItem;

export type MatchedPair = {
  amount: number;
  screenshot: ScreenshotItem;
  invoice: InvoiceItem;
  matchedAt: number;
};

export type TimeoutCallback = (item: PoolItem) => Promise<void> | void;

export type MatchPoolOptions = {
  toleranceCents?: number;
  pendingTtlMs?: number;
  onTimeout?: TimeoutCallback;
};

export class MatchPool {
  private screenshots = new Map<string, ScreenshotItem>();
  private invoices = new Map<string, InvoiceItem>();
  private screenshotBuckets = new Map<string, Map<number, Set<string>>>();
  private invoiceBuckets = new Map<string, Map<number, Set<string>>>();
  private timers = new Map<string, NodeJS.Timeout>();
  private readonly toleranceCents: number;
  private readonly pendingTtlMs: number;
  private readonly onTimeout?: TimeoutCallback;

  constructor(options: MatchPoolOptions = {}) {
    this.toleranceCents = options.toleranceCents ?? 0;
    this.pendingTtlMs = options.pendingTtlMs ?? 2 * 60 * 60 * 1000;
    this.onTimeout = options.onTimeout;
  }

  addScreenshot(item: Omit<ScreenshotItem, "kind" | "createdAt">): { matched?: MatchedPair; pendingId?: string } {
    const normalized: ScreenshotItem = {
      ...item,
      kind: "screenshot",
      createdAt: Date.now(),
      amount: normalizeAmount(item.amount)
    };

    const matchedInvoice = this.findBestInvoiceMatch(normalized);
    if (matchedInvoice) {
      this.removeInvoice(matchedInvoice.id);
      return { matched: this.createMatch(normalized, matchedInvoice) };
    }

    this.screenshots.set(normalized.id, normalized);
    this.pushToBucket(this.screenshotBuckets, normalized.scopeKey, amountToCents(normalized.amount), normalized.id);
    this.startTimeout(normalized);
    return { pendingId: normalized.id };
  }

  addInvoice(item: Omit<InvoiceItem, "kind" | "createdAt">): { matched?: MatchedPair; pendingId?: string } {
    const normalized: InvoiceItem = {
      ...item,
      kind: "invoice",
      createdAt: Date.now(),
      amount: normalizeAmount(item.amount)
    };

    const matchedScreenshot = this.findBestScreenshotMatch(normalized);
    if (matchedScreenshot) {
      this.removeScreenshot(matchedScreenshot.id);
      return { matched: this.createMatch(matchedScreenshot, normalized) };
    }

    this.invoices.set(normalized.id, normalized);
    this.pushToBucket(this.invoiceBuckets, normalized.scopeKey, amountToCents(normalized.amount), normalized.id);
    this.startTimeout(normalized);
    return { pendingId: normalized.id };
  }

  voidItem(kind: PoolItemKind, id: string): boolean {
    if (kind === "screenshot") {
      return this.removeScreenshot(id);
    }
    return this.removeInvoice(id);
  }

  getPendingByScope(scopeKey: string): PoolItem[] {
    const pending: PoolItem[] = [];
    for (const item of this.screenshots.values()) {
      if (item.scopeKey === scopeKey) pending.push(item);
    }
    for (const item of this.invoices.values()) {
      if (item.scopeKey === scopeKey) pending.push(item);
    }
    return pending.sort((a, b) => a.createdAt - b.createdAt);
  }

  private createMatch(screenshot: ScreenshotItem, invoice: InvoiceItem): MatchedPair {
    this.clearTimer(screenshot.id);
    this.clearTimer(invoice.id);
    return {
      amount: screenshot.amount,
      screenshot,
      invoice,
      matchedAt: Date.now()
    };
  }

  private findBestInvoiceMatch(target: ScreenshotItem): InvoiceItem | undefined {
    const candidateIds = this.getCandidateIds(this.invoiceBuckets, target.scopeKey, target.amount);
    const candidates = candidateIds
      .map((id) => this.invoices.get(id))
      .filter((v): v is InvoiceItem => Boolean(v));
    return selectBestByAmountAndTime(target.amount, candidates);
  }

  private findBestScreenshotMatch(target: InvoiceItem): ScreenshotItem | undefined {
    const candidateIds = this.getCandidateIds(this.screenshotBuckets, target.scopeKey, target.amount);
    const candidates = candidateIds
      .map((id) => this.screenshots.get(id))
      .filter((v): v is ScreenshotItem => Boolean(v));
    return selectBestByAmountAndTime(target.amount, candidates);
  }

  private getCandidateIds(
    source: Map<string, Map<number, Set<string>>>,
    scopeKey: string,
    amount: number
  ): string[] {
    const cents = amountToCents(amount);
    const scopeMap = source.get(scopeKey);
    if (!scopeMap) return [];

    const result: string[] = [];
    for (let delta = -this.toleranceCents; delta <= this.toleranceCents; delta += 1) {
      const set = scopeMap.get(cents + delta);
      if (!set) continue;
      result.push(...set);
    }
    return result;
  }

  private pushToBucket(
    source: Map<string, Map<number, Set<string>>>,
    scopeKey: string,
    cents: number,
    id: string
  ): void {
    const scopeMap = source.get(scopeKey) ?? new Map<number, Set<string>>();
    const bucket = scopeMap.get(cents) ?? new Set<string>();
    bucket.add(id);
    scopeMap.set(cents, bucket);
    source.set(scopeKey, scopeMap);
  }

  private removeFromBucket(
    source: Map<string, Map<number, Set<string>>>,
    scopeKey: string,
    cents: number,
    id: string
  ): void {
    const scopeMap = source.get(scopeKey);
    if (!scopeMap) return;
    const bucket = scopeMap.get(cents);
    if (!bucket) return;
    bucket.delete(id);
    if (bucket.size === 0) {
      scopeMap.delete(cents);
    }
    if (scopeMap.size === 0) {
      source.delete(scopeKey);
    }
  }

  private removeScreenshot(id: string): boolean {
    const item = this.screenshots.get(id);
    if (!item) return false;
    this.clearTimer(id);
    this.screenshots.delete(id);
    this.removeFromBucket(this.screenshotBuckets, item.scopeKey, amountToCents(item.amount), id);
    return true;
  }

  private removeInvoice(id: string): boolean {
    const item = this.invoices.get(id);
    if (!item) return false;
    this.clearTimer(id);
    this.invoices.delete(id);
    this.removeFromBucket(this.invoiceBuckets, item.scopeKey, amountToCents(item.amount), id);
    return true;
  }

  private startTimeout(item: PoolItem): void {
    this.clearTimer(item.id);
    const timer = setTimeout(async () => {
      const current = item.kind === "screenshot" ? this.screenshots.get(item.id) : this.invoices.get(item.id);
      if (!current) return;
      if (item.kind === "screenshot") {
        this.removeScreenshot(item.id);
      } else {
        this.removeInvoice(item.id);
      }
      if (this.onTimeout) {
        await this.onTimeout(current);
      }
    }, this.pendingTtlMs);
    this.timers.set(item.id, timer);
  }

  private clearTimer(id: string): void {
    const timer = this.timers.get(id);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(id);
    }
  }
}

function amountToCents(amount: number): number {
  return Math.round(normalizeAmount(amount) * 100);
}

function normalizeAmount(amount: number): number {
  return Number(amount.toFixed(2));
}

function selectBestByAmountAndTime<T extends { amount: number; createdAt: number }>(
  targetAmount: number,
  candidates: T[]
): T | undefined {
  if (!candidates.length) return undefined;
  return candidates
    .slice()
    .sort((a, b) => {
      const amountDiff = Math.abs(a.amount - targetAmount) - Math.abs(b.amount - targetAmount);
      if (amountDiff !== 0) return amountDiff;
      return a.createdAt - b.createdAt;
    })[0];
}

