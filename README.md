# Accounting-Tool 2.0(Feishu Bot)

一个 AI 自动记账机器人。

核心体验：
- 首次 `npm start` 自动 CLI 引导，写入 `.env`
- 自动校验飞书权限并自动创建多维表格（首次）
- 飞书机器人通过 WebSocket 长连接接收图片/PDF
- 图片与发票按金额自动配对，成功后自动写入多维表格
- 未匹配条目超时后自动提醒（Human-in-the-Loop）

---

## 1. 环境要求

- Node.js `>= 20`
- npm `>= 9`
- 一个可用的飞书自建应用（机器人）
- OpenRouter API Key

---

## 2. 安装依赖

```bash
npm install
```

---

## 3. 飞书应用配置（必须）

在飞书开放平台创建自建应用，并启用机器人能力。

建议至少开通以下权限（按实际接口再补充）：
- `im:message`
- `drive:drive`
- `bitable:app`

将应用安装到你的企业/团队，并确保机器人可在目标会话中收发消息。

---

## 4. 首次启动（自动初始化）

```bash
npm start
```

首次无 `.env` 时，会自动出现 CLI 向导并询问：
- `OpenRouter API Key`
- `飞书 App ID`
- `飞书 App Secret`

保存后程序会自动：
1. 校验飞书权限
2. 检查或创建 `AI自动记账本`
3. 检查或创建 `记账明细` 表
4. 自动补齐字段：
   - `日期`
   - `金额`
   - `发票`（附件）
   - `订单截图`（附件）

成功后终端会显示 Bitable 链接，并进入 WebSocket 常驻监听。

---

## 5. 开发命令

```bash
# 开发模式（直接运行 src）
npm run dev

# 编译（TypeScript -> dist）
npm run build

# 自动测试
npm test

# 批量回补（默认处理 ./pending 目录）
npm run batch

# 指定任意目录做批量匹配归档
npm run dev -- --batch-dir ./your-folder
```

---

## 6. 使用教程

1. 在飞书给机器人发送付款截图（图片）
2. 机器人先回复“已收到，正在识别...”
3. 再发送对应 PDF 发票
4. 系统按金额配对成功后，自动写表并回执成功卡片
5. 超时未配对的记录会发送提醒卡片

批量回补模式：
1. 把未匹配的截图和 PDF 放到同一目录（可包含子目录）
2. 执行 `npm run dev -- --batch-dir ./pending`
3. 程序会用 VLM 识别截图金额、解析 PDF 金额，按金额配对
4. 配对成功即写入飞书多维表格同一行（日期/金额/发票/截图）
5. 终端输出未匹配清单，便于人工补齐

---

## 7. 配置项说明（`.env`）

参考 `.env.example`：

```env
OPENROUTER_API_KEY=
OPENROUTER_VLM_MODEL=qwen/qwen2.5-vl-72b-instruct
LARK_APP_ID=
LARK_APP_SECRET=
LARK_BASE_NAME=AI自动记账本
LARK_TABLE_NAME=记账明细
LARK_BASE_TOKEN=
LARK_TABLE_ID=
UNMATCHED_REMINDER_MINUTES=120
```

说明：
- `LARK_BASE_TOKEN` / `LARK_TABLE_ID` 首次初始化后会自动回填
- `UNMATCHED_REMINDER_MINUTES` 控制未匹配提醒时间

---

## 8. 项目结构（当前版本）

```text
src/
├─ index.ts                 # 程序入口（CLI + 初始化 + WS启动）
├─ cli/                     # 首次引导交互
├─ config/                  # 环境变量与常量
├─ lark/                    # 飞书 API / WebSocket / 消息卡片
├─ agent/                   # PDF 解析与匹配池
├─ services/                # OpenRouter 与业务编排
├─ types/                   # 类型定义
└─ utils/                   # 金额等工具函数
```

---

## 9. 部署建议

可将该程序部署为长期运行的 Node 进程（如 PM2 / systemd / Docker）。

最简方式（PM2）：
```bash
npm run build
pm2 start "node dist/index.js" --name accounting-tool
pm2 save
```

---

## 10. 常见问题

- 启动后收不到飞书消息  
  检查应用是否已发布并安装到企业，机器人是否在会话中可见，事件订阅是否开启。

- 能收到消息但写表失败  
  检查应用是否具备 `bitable` 与 `drive` 权限，且目标多维表格可访问。

- 金额识别偏差  
  可更换 `OPENROUTER_VLM_MODEL`，或在图片识别提示词中强化“仅实付款”约束。
