import { writeFileSync } from "node:fs";
import { ACCOUNTING_FIELDS } from "../config/constants.js";
import { getEnvFilePath, type AppEnv } from "../config/env.js";
import { LarkApiService } from "./api.js";

type FeishuResponse<T> = {
  code: number;
  msg: string;
  data: T;
};

type BitableApp = {
  app_token: string;
  name: string;
};

type BitableTable = {
  table_id: string;
  name: string;
};

type BitableField = {
  field_id: string;
  field_name: string;
};

export class LarkInitializer {
  private readonly api: LarkApiService;

  constructor(private readonly env: AppEnv, private readonly cwd: string = process.cwd()) {
    this.api = new LarkApiService({
      appId: env.LARK_APP_ID,
      appSecret: env.LARK_APP_SECRET
    });
  }

  async verifyAndPrepareBitable(): Promise<{ baseToken: string; tableId: string; baseUrl: string }> {
    const token = await this.api.getTenantToken();
    const existingBase = this.env.LARK_BASE_TOKEN
      ? await this.safeGetBaseByToken(token, this.env.LARK_BASE_TOKEN)
      : null;
    const base = existingBase ?? (await this.createBase(token, this.env.LARK_BASE_NAME));
    const table = await this.ensureTableAndFields(token, base.app_token);

    this.persistRuntimeEnv(base.app_token, table.table_id);
    return {
      baseToken: base.app_token,
      tableId: table.table_id,
      baseUrl: `https://feishu.cn/base/${base.app_token}`
    };
  }

  async verifyPermissionOnly(): Promise<void> {
    await this.api.getTenantToken();
  }

  private async safeGetBaseByToken(token: string, appToken: string): Promise<BitableApp | null> {
    try {
      type Data = { app: BitableApp };
      const data = await this.request<Data>({
        token,
        path: `/open-apis/bitable/v1/apps/${appToken}`,
        method: "GET"
      });
      return data.app;
    } catch {
      return null;
    }
  }

  private async createBase(token: string, name: string): Promise<BitableApp> {
    type Data = { app: BitableApp };
    const data = await this.request<Data>({
      token,
      path: "/open-apis/bitable/v1/apps",
      method: "POST",
      body: { name }
    });
    return data.app;
  }

  private async ensureTableAndFields(token: string, appToken: string): Promise<BitableTable> {
    const table = this.env.LARK_TABLE_ID
      ? await this.safeGetTableById(token, appToken, this.env.LARK_TABLE_ID)
      : await this.findTableByName(token, appToken, this.env.LARK_TABLE_NAME);
    const readyTable = table ?? (await this.createTable(token, appToken, this.env.LARK_TABLE_NAME));
    await this.ensureFields(token, appToken, readyTable.table_id);
    return readyTable;
  }

  private async safeGetTableById(token: string, appToken: string, tableId: string): Promise<BitableTable | null> {
    try {
      type Data = { table?: BitableTable; table_id?: string; name?: string };
      const data = await this.request<Data>({
        token,
        path: `/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}`,
        method: "GET"
      });
      return this.extractTable(data);
    } catch {
      return null;
    }
  }

  private async findTableByName(token: string, appToken: string, tableName: string): Promise<BitableTable | null> {
    type Data = { items: BitableTable[] };
    const data = await this.request<Data>({
      token,
      path: `/open-apis/bitable/v1/apps/${appToken}/tables?page_size=200`,
      method: "GET"
    });
    return data.items.find((item) => item.name === tableName) ?? null;
  }

  private async createTable(token: string, appToken: string, tableName: string): Promise<BitableTable> {
    type Data = {
      table?: BitableTable;
      table_id?: string;
      name?: string;
      items?: Array<{ table_id?: string; name?: string }>;
    };

    const data = await this.request<Data>({
      token,
      path: `/open-apis/bitable/v1/apps/${appToken}/tables`,
      method: "POST",
      body: {
        table: {
          name: tableName
        }
      }
    });

    const table = this.extractTable(data);
    if (!table) {
      throw new Error("create table succeeded but response has no table_id");
    }
    return table;
  }

  private async ensureFields(token: string, appToken: string, tableId: string): Promise<void> {
    type Data = { items: BitableField[] };
    const data = await this.request<Data>({
      token,
      path: `/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}/fields?page_size=200`,
      method: "GET"
    });

    const existing = new Set(data.items.map((f) => f.field_name));
    for (const field of ACCOUNTING_FIELDS) {
      if (existing.has(field.field_name)) continue;
      try {
        await this.request({
          token,
          path: `/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}/fields`,
          method: "POST",
          body: {
            field_name: field.field_name,
            type: field.type
          }
        });
      } catch {
        await this.request({
          token,
          path: `/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}/fields`,
          method: "POST",
          body: { field }
        });
      }
    }
  }

  private async request<T>(params: {
    token: string;
    path: string;
    method: "GET" | "POST";
    body?: Record<string, unknown>;
  }): Promise<T> {
    const res = await fetch(`https://open.feishu.cn${params.path}`, {
      method: params.method,
      headers: {
        Authorization: `Bearer ${params.token}`,
        "Content-Type": "application/json; charset=utf-8"
      },
      body: params.body ? JSON.stringify(params.body) : undefined
    });

    const body = await this.parseResponse<T>(res, params.path);
    if (!res.ok || body.code !== 0) {
      throw new Error(`飞书请求失败 ${params.path}: ${body.msg || res.statusText}`);
    }
    return body.data;
  }

  private async parseResponse<T>(res: Response, path: string): Promise<FeishuResponse<T>> {
    const raw = await res.text();
    const text = stripBom(raw).trim();
    try {
      return JSON.parse(text) as FeishuResponse<T>;
    } catch {
      const preview = text.slice(0, 300).replace(/\s+/g, " ");
      throw new Error(
        `飞书接口返回了非 JSON 数据 (${path})。HTTP ${res.status} ${res.statusText}，响应片段: ${preview || "<empty>"}`
      );
    }
  }

  private extractTable(data: {
    table?: BitableTable;
    table_id?: string;
    name?: string;
    items?: Array<{ table_id?: string; name?: string }>;
  }): BitableTable | null {
    if (data.table?.table_id) {
      return data.table;
    }
    if (data.table_id) {
      return {
        table_id: data.table_id,
        name: data.name ?? this.env.LARK_TABLE_NAME
      };
    }

    const first = data.items?.find((item) => Boolean(item.table_id));
    if (first?.table_id) {
      return {
        table_id: first.table_id,
        name: first.name ?? this.env.LARK_TABLE_NAME
      };
    }

    return null;
  }

  private persistRuntimeEnv(baseToken: string, tableId: string): void {
    const lines = [
      `OPENROUTER_API_KEY=${this.env.OPENROUTER_API_KEY}`,
      `OPENROUTER_VLM_MODEL=${this.env.OPENROUTER_VLM_MODEL ?? "qwen/qwen2.5-vl-72b-instruct"}`,
      `LARK_APP_ID=${this.env.LARK_APP_ID}`,
      `LARK_APP_SECRET=${this.env.LARK_APP_SECRET}`,
      `LARK_BASE_NAME=${this.env.LARK_BASE_NAME}`,
      `LARK_TABLE_NAME=${this.env.LARK_TABLE_NAME}`,
      `LARK_BASE_TOKEN=${baseToken}`,
      `LARK_TABLE_ID=${tableId}`,
      `UNMATCHED_REMINDER_MINUTES=${this.env.UNMATCHED_REMINDER_MINUTES}`
    ];
    writeFileSync(getEnvFilePath(this.cwd), `${lines.join("\n")}\n`, "utf8");
  }
}

function stripBom(input: string): string {
  return input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
}
