import OpenAI from "openai";
import { extractAmountCandidates, normalizeAmount } from "../utils/amount.js";

export type OpenRouterServiceOptions = {
  apiKey: string;
  model?: string;
};

export class OpenRouterService {
  private readonly client: OpenAI;
  private readonly model: string;

  constructor(options: OpenRouterServiceOptions) {
    this.client = new OpenAI({
      apiKey: options.apiKey,
      baseURL: "https://openrouter.ai/api/v1"
    });
    this.model = options.model ?? "qwen/qwen2.5-vl-72b-instruct";
  }

  async extractPaidAmountFromImage(imageBuffer: Buffer, mimeType: string = "image/jpeg"): Promise<number> {
    const base64 = imageBuffer.toString("base64");
    const response = await this.client.chat.completions.create({
      model: this.model,
      temperature: 0,
      messages: [
        {
          role: "system",
          content:
            "你是账单识别助手。只关注付款截图中的“实付款/支付金额/合计实付”并输出一个数字金额，不要输出其他文本。"
        },
        {
          role: "user",
          content: [
            { type: "text", text: "识别这张截图的实付款金额，仅返回金额数字，例如 35.50" },
            { type: "image_url", image_url: { url: `data:${mimeType};base64,${base64}` } }
          ]
        }
      ]
    });

    const text = response.choices[0]?.message?.content?.trim() ?? "";
    const amounts = extractAmountCandidates(text);
    if (!amounts.length) {
      throw new Error("模型未返回可用金额");
    }
    return normalizeAmount(amounts[0]);
  }
}

