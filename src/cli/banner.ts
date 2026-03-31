import { intro } from "@clack/prompts";

export function showWelcomeBanner(): void {
  console.clear();
  intro("✨ 欢迎使用 AI 自动记账管家 (TypeScript Edition)");
}

