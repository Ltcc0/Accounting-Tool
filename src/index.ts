import path from "node:path";
import { outro, spinner } from "@clack/prompts";
import { showWelcomeBanner } from "./cli/banner.js";
import { runInitWizard } from "./cli/init-wizard.js";
import { envFileExists, loadEnv } from "./config/env.js";
import { LarkApiService } from "./lark/api.js";
import { LarkInitializer } from "./lark/http.js";
import { LarkWsBot } from "./lark/ws-bot.js";
import { AccountingService } from "./services/accounting-service.js";
import { BatchArchiver } from "./services/batch-archiver.js";

async function bootstrap(): Promise<void> {
  showWelcomeBanner();

  if (!envFileExists()) {
    await runInitWizard();
    console.log("💾 配置已保存至本地 .env 文件。");
  }

  const env = loadEnv();
  const initializer = new LarkInitializer(env);
  const s = spinner();

  s.start("⠋ 正在连接飞书并校验权限...");
  await initializer.verifyPermissionOnly();
  s.stop("✅ 校验成功");

  s.start("⠋ 正在检查飞书云文档中的多维表格状态...");
  const { baseUrl } = await initializer.verifyAndPrepareBitable();
  s.stop("✅ 多维表格已就绪");

  const runtimeEnv = loadEnv();
  const larkApi = new LarkApiService({
    appId: runtimeEnv.LARK_APP_ID,
    appSecret: runtimeEnv.LARK_APP_SECRET
  });

  const batchDir = parseBatchDirArg(process.argv);
  if (batchDir) {
    const archiver = new BatchArchiver(runtimeEnv, larkApi);
    const absDir = path.resolve(batchDir);
    console.log(`🧠 开始批量回补目录: ${absDir}`);
    const report = await archiver.run(absDir);
    console.log(`✅ 批量归档完成，成功配对 ${report.matchedCount} 对`);
    if (report.unmatchedImages.length) {
      console.log(`⚠️ 未匹配截图(${report.unmatchedImages.length}): ${report.unmatchedImages.join(", ")}`);
    }
    if (report.unmatchedPdfs.length) {
      console.log(`⚠️ 未匹配发票(${report.unmatchedPdfs.length}): ${report.unmatchedPdfs.join(", ")}`);
    }
    outro("批量处理结束。");
    return;
  }

  const accountingService = new AccountingService(runtimeEnv, larkApi);
  const wsBot = new LarkWsBot(runtimeEnv.LARK_APP_ID, runtimeEnv.LARK_APP_SECRET, async (message) => {
    await accountingService.handleIncomingMessage(message);
  });
  wsBot.start();

  console.log(`🎉 初始化完成！您的记账本链接为: ${baseUrl}`);
  console.log("🚀 长连接 (WebSocket) 已建立！请前往飞书客户端向机器人发送图片或发票。");
  outro("服务运行中，按 Ctrl+C 退出。");
}

function parseBatchDirArg(argv: string[]): string | undefined {
  const idx = argv.findIndex((item) => item === "--batch-dir");
  if (idx >= 0 && argv[idx + 1]) {
    return argv[idx + 1];
  }
  return undefined;
}

bootstrap().catch((error) => {
  console.error("❌ 启动失败:", error instanceof Error ? error.message : String(error));
  process.exit(1);
});

