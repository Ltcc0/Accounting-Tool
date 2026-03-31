import { randomUUID } from "node:crypto";
import { MatchPool, type PoolItem } from "../agent/match-pool.js";
import { parseInvoicePdf } from "../agent/pdf-parse.js";
import type { AppEnv } from "../config/env.js";
import { LarkApiService } from "../lark/api.js";
import { buildArchivedSuccessCard, buildUnmatchedReminderCard } from "../lark/cards.js";
import type { LarkIncomingMessage } from "../types/lark.js";
import { OpenRouterService } from "./openrouter.js";

export class AccountingService {
  private readonly pool: MatchPool;
  private readonly llm: OpenRouterService;

  constructor(
    private readonly env: AppEnv,
    private readonly larkApi: LarkApiService
  ) {
    this.llm = new OpenRouterService({
      apiKey: env.OPENROUTER_API_KEY,
      model: env.OPENROUTER_VLM_MODEL
    });
    this.pool = new MatchPool({
      toleranceCents: 0,
      pendingTtlMs: env.UNMATCHED_REMINDER_MINUTES * 60 * 1000,
      onTimeout: async (item) => this.handleTimeout(item)
    });
  }

  async handleIncomingMessage(message: LarkIncomingMessage): Promise<void> {
    if (message.messageType === "image") {
      await this.handleScreenshot(message);
      return;
    }

    if (message.messageType === "file") {
      const fileName = String(message.content.file_name ?? "");
      if (fileName.toLowerCase().endsWith(".pdf")) {
        await this.handleInvoicePdf(message, fileName);
      }
    }
  }

  private async handleScreenshot(message: LarkIncomingMessage): Promise<void> {
    await this.larkApi.sendText(message.chatId, "👀 已收到订单截图，Agent 正在识别金额...");

    const imageKey = String(message.content.image_key ?? "");
    if (!imageKey) {
      await this.larkApi.sendText(message.chatId, "❌ 未读取到图片资源，请重试发送图片。");
      return;
    }

    const imageBuffer = await this.larkApi.downloadMessageResource(message.messageId, imageKey, "image");
    const amount = await this.llm.extractPaidAmountFromImage(imageBuffer);
    const imageFileToken = await this.larkApi.uploadToBitableMedia(
      this.env.LARK_BASE_TOKEN ?? "",
      `screenshot-${Date.now()}.jpg`,
      imageBuffer,
      "image/jpeg"
    );

    const result = this.pool.addScreenshot({
      id: randomUUID(),
      amount,
      scopeKey: message.chatId,
      chatId: message.chatId,
      messageId: message.messageId,
      imageFileToken
    });

    if (result.matched) {
      await this.archiveMatchedPair(
        result.matched.invoice.amount,
        result.matched.invoice.pdfFileToken,
        result.matched.screenshot.imageFileToken,
        result.matched.invoice.invoiceDate,
        message.chatId
      );
      return;
    }

    await this.larkApi.sendText(
      message.chatId,
      `💰 截图识别成功：实付款 ${amount.toFixed(2)} 元。当前状态：[⏳ 等待发票配对]`
    );
  }

  private async handleInvoicePdf(message: LarkIncomingMessage, fileName: string): Promise<void> {
    await this.larkApi.sendText(message.chatId, "📄 已收到 PDF 发票，正在解析...");

    const fileKey = String(message.content.file_key ?? "");
    if (!fileKey) {
      await this.larkApi.sendText(message.chatId, "❌ 未读取到 PDF 资源，请重试发送文件。");
      return;
    }

    const pdfBuffer = await this.larkApi.downloadMessageResource(message.messageId, fileKey, "file");
    const parsed = await parseInvoicePdf(pdfBuffer);
    const pdfFileToken = await this.larkApi.uploadToBitableMedia(
      this.env.LARK_BASE_TOKEN ?? "",
      fileName || `invoice-${Date.now()}.pdf`,
      pdfBuffer,
      "application/pdf"
    );

    const result = this.pool.addInvoice({
      id: randomUUID(),
      amount: parsed.amount,
      scopeKey: message.chatId,
      chatId: message.chatId,
      messageId: message.messageId,
      invoiceDate: parsed.date,
      pdfFileToken
    });

    if (result.matched) {
      await this.archiveMatchedPair(
        result.matched.amount,
        result.matched.invoice.pdfFileToken,
        result.matched.screenshot.imageFileToken,
        result.matched.invoice.invoiceDate,
        message.chatId
      );
      return;
    }

    await this.larkApi.sendText(
      message.chatId,
      `🧾 发票解析成功：金额 ${parsed.amount.toFixed(2)} 元。当前状态：[⏳ 等待截图配对]`
    );
  }

  private async archiveMatchedPair(
    amount: number,
    invoiceFileToken: string,
    screenshotFileToken: string,
    date: string | undefined,
    chatId: string
  ): Promise<void> {
    if (!this.env.LARK_BASE_TOKEN || !this.env.LARK_TABLE_ID) {
      throw new Error("缺少 LARK_BASE_TOKEN / LARK_TABLE_ID，请重新初始化");
    }

    await this.larkApi.createAccountingRecord(this.env.LARK_BASE_TOKEN, this.env.LARK_TABLE_ID, {
      amount,
      invoiceFileToken,
      screenshotFileToken,
      date
    });
    await this.larkApi.sendCard(chatId, buildArchivedSuccessCard(amount));
  }

  private async handleTimeout(item: PoolItem): Promise<void> {
    if (!item.chatId) return;
    await this.larkApi.sendCard(item.chatId, buildUnmatchedReminderCard(item.amount));
  }
}
