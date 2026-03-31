import dayjs from "dayjs";
import type { MessageResourceType } from "../types/lark.js";

type TokenCache = {
  value: string;
  expiredAt: number;
};

export type LarkApiOptions = {
  appId: string;
  appSecret: string;
};

export type CreateRecordPayload = {
  amount: number;
  invoiceFileToken: string;
  screenshotFileToken: string;
  date?: string;
};

export class LarkApiService {
  private tokenCache?: TokenCache;

  constructor(private readonly options: LarkApiOptions) {}

  async getTenantToken(): Promise<string> {
    if (this.tokenCache && Date.now() < this.tokenCache.expiredAt) {
      return this.tokenCache.value;
    }

    const res = await fetch("https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal", {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({
        app_id: this.options.appId,
        app_secret: this.options.appSecret
      })
    });

    const json = (await res.json()) as {
      code: number;
      msg: string;
      tenant_access_token?: string;
      expire?: number;
    };

    if (!res.ok || json.code !== 0 || !json.tenant_access_token) {
      throw new Error(`获取飞书 token 失败: ${json.msg || res.statusText}`);
    }

    const ttl = Math.max(300, (json.expire ?? 7200) - 120);
    this.tokenCache = {
      value: json.tenant_access_token,
      expiredAt: Date.now() + ttl * 1000
    };
    return json.tenant_access_token;
  }

  async sendText(chatId: string, text: string): Promise<void> {
    const token = await this.getTenantToken();
    await this.post("/open-apis/im/v1/messages?receive_id_type=chat_id", token, {
      receive_id: chatId,
      msg_type: "text",
      content: JSON.stringify({ text })
    });
  }

  async sendCard(chatId: string, card: Record<string, unknown>): Promise<void> {
    const token = await this.getTenantToken();
    await this.post("/open-apis/im/v1/messages?receive_id_type=chat_id", token, {
      receive_id: chatId,
      msg_type: "interactive",
      content: JSON.stringify(card)
    });
  }

  async downloadMessageResource(messageId: string, fileKey: string, type: MessageResourceType): Promise<Buffer> {
    const token = await this.getTenantToken();
    const path = `/open-apis/im/v1/messages/${messageId}/resources/${fileKey}?type=${type}`;
    const res = await fetch(`https://open.feishu.cn${path}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) {
      throw new Error(`下载飞书文件失败: ${res.status} ${res.statusText}`);
    }
    const bytes = await res.arrayBuffer();
    return Buffer.from(bytes);
  }

  async uploadToBitableMedia(baseToken: string, fileName: string, buffer: Buffer, mimeType: string): Promise<string> {
    const token = await this.getTenantToken();
    const form = new FormData();
    form.append("file_name", fileName);
    form.append("parent_type", "bitable_file");
    form.append("parent_node", baseToken);
    form.append("size", String(buffer.byteLength));
    const bytes = new Uint8Array(buffer);
    form.append("file", new Blob([bytes], { type: mimeType }), fileName);

    const res = await fetch("https://open.feishu.cn/open-apis/drive/v1/medias/upload_all", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`
      },
      body: form
    });

    const json = (await res.json()) as {
      code: number;
      msg: string;
      data?: { file_token?: string };
    };
    if (!res.ok || json.code !== 0 || !json.data?.file_token) {
      throw new Error(`上传附件失败: ${json.msg || res.statusText}`);
    }
    return json.data.file_token;
  }

  async createAccountingRecord(baseToken: string, tableId: string, payload: CreateRecordPayload): Promise<void> {
    const token = await this.getTenantToken();
    const dateValue = payload.date ? dayjs(payload.date).valueOf() : Date.now();
    await this.post(`/open-apis/bitable/v1/apps/${baseToken}/tables/${tableId}/records`, token, {
      fields: {
        日期: dateValue,
        金额: payload.amount,
        发票: [{ file_token: payload.invoiceFileToken }],
        订单截图: [{ file_token: payload.screenshotFileToken }]
      }
    });
  }

  private async post(path: string, token: string, body: Record<string, unknown>): Promise<void> {
    const res = await fetch(`https://open.feishu.cn${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json; charset=utf-8"
      },
      body: JSON.stringify(body)
    });

    const json = (await res.json()) as { code: number; msg: string };
    if (!res.ok || json.code !== 0) {
      throw new Error(`飞书请求失败 ${path}: ${json.msg || res.statusText}`);
    }
  }
}
