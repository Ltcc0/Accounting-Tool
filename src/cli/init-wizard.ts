import { isCancel, outro, password, text } from "@clack/prompts";
import { writeFileSync } from "node:fs";
import { getEnvFilePath } from "../config/env.js";
import { DEFAULT_BASE_NAME, DEFAULT_TABLE_NAME } from "../config/constants.js";

function ensureNotCancelled<T>(value: T | symbol): T {
  if (isCancel(value)) {
    outro("已取消初始化。");
    process.exit(0);
  }
  return value as T;
}

export async function runInitWizard(cwd: string = process.cwd()): Promise<void> {
  const openRouterKey = ensureNotCancelled(
    await password({
      message: "[?] 请输入您的 OpenRouter API Key (必填):",
      validate: (value) => (value.trim() ? undefined : "API Key 不能为空")
    })
  );

  const appId = ensureNotCancelled(
    await text({
      message: "[?] 请输入您的 飞书 App ID (必填):",
      validate: (value) => (value.trim() ? undefined : "App ID 不能为空")
    })
  );

  const appSecret = ensureNotCancelled(
    await password({
      message: "[?] 请输入您的 飞书 App Secret (必填):",
      validate: (value) => (value.trim() ? undefined : "App Secret 不能为空")
    })
  );

  const envFile = [
    `OPENROUTER_API_KEY=${openRouterKey.trim()}`,
    "OPENROUTER_VLM_MODEL=qwen/qwen2.5-vl-72b-instruct",
    `LARK_APP_ID=${appId.trim()}`,
    `LARK_APP_SECRET=${appSecret.trim()}`,
    `LARK_BASE_NAME=${DEFAULT_BASE_NAME}`,
    `LARK_TABLE_NAME=${DEFAULT_TABLE_NAME}`,
    "LARK_BASE_TOKEN=",
    "LARK_TABLE_ID=",
    "UNMATCHED_REMINDER_MINUTES=120"
  ].join("\n");

  writeFileSync(getEnvFilePath(cwd), `${envFile}\n`, "utf8");
}
