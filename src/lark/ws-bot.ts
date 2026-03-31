import { EventDispatcher, WSClient } from "@larksuiteoapi/node-sdk";
import type { LarkIncomingMessage, LarkMessageType } from "../types/lark.js";

type RawEvent = {
  event?: {
    message?: {
      message_id?: string;
      chat_id?: string;
      message_type?: string;
      content?: string;
    };
    sender?: {
      sender_id?: {
        open_id?: string;
      };
    };
  };
};

export type BotMessageHandler = (message: LarkIncomingMessage) => Promise<void>;

export class LarkWsBot {
  private wsClient?: WSClient;

  constructor(
    private readonly appId: string,
    private readonly appSecret: string,
    private readonly onMessage: BotMessageHandler
  ) {}

  start(): void {
    const dispatcher = new EventDispatcher({});
    dispatcher.register({
      "im.message.receive_v1": async (payload: RawEvent) => {
        const parsed = parseMessage(payload);
        if (!parsed) return;
        await this.onMessage(parsed);
      }
    });

    this.wsClient = new WSClient({
      appId: this.appId,
      appSecret: this.appSecret,
    });
    void this.wsClient.start({ eventDispatcher: dispatcher });
  }
}

function parseMessage(payload: RawEvent): LarkIncomingMessage | null {
  const msg = payload.event?.message;
  if (!msg?.message_id || !msg.chat_id) return null;

  let content: Record<string, unknown> = {};
  if (msg.content) {
    try {
      content = JSON.parse(msg.content) as Record<string, unknown>;
    } catch {
      content = {};
    }
  }

  return {
    messageId: msg.message_id,
    chatId: msg.chat_id,
    senderOpenId: payload.event?.sender?.sender_id?.open_id ?? "",
    messageType: mapMessageType(msg.message_type),
    content
  };
}

function mapMessageType(input?: string): LarkMessageType {
  if (input === "image") return "image";
  if (input === "file") return "file";
  if (input === "text") return "text";
  return "unknown";
}
