export type LarkMessageType = "image" | "file" | "text" | "unknown";

export type LarkIncomingMessage = {
  messageId: string;
  chatId: string;
  senderOpenId: string;
  messageType: LarkMessageType;
  content: Record<string, unknown>;
};

export type MessageResourceType = "image" | "file";

