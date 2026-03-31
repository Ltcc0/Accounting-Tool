export type LarkMessageTarget = {
  receiveId: string;
  receiveIdType?: "chat_id" | "open_id" | "user_id" | "email" | "union_id";
};

export class LarkMessageService {
  constructor(private readonly tenantAccessToken: string) {}

  async sendText(target: LarkMessageTarget, text: string): Promise<{ messageId: string }> {
    const receiveIdType = target.receiveIdType ?? "chat_id";
    const data = await this.request<{ message_id: string }>(
      `/open-apis/im/v1/messages?receive_id_type=${receiveIdType}`,
      {
        receive_id: target.receiveId,
        msg_type: "text",
        content: JSON.stringify({ text })
      }
    );
    return { messageId: data.message_id };
  }

  async sendLoadingAndDone(
    target: LarkMessageTarget,
    loadingText: string,
    doneText: string,
    worker: () => Promise<void>
  ): Promise<void> {
    await this.sendText(target, loadingText);
    try {
      await worker();
      await this.sendText(target, doneText);
    } catch (error) {
      await this.sendText(target, `❌ 处理失败：${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }

  private async request<T>(path: string, body: Record<string, unknown>): Promise<T> {
    const res = await fetch(`https://open.feishu.cn${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.tenantAccessToken}`,
        "Content-Type": "application/json; charset=utf-8"
      },
      body: JSON.stringify(body)
    });
    const json = (await res.json()) as { code: number; msg: string; data: T };
    if (!res.ok || json.code !== 0) {
      throw new Error(`飞书消息发送失败: ${json.msg || res.statusText}`);
    }
    return json.data;
  }
}

