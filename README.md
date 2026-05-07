# Accounting-Tool 2.0 (Feishu/Lark Bot)

An AI-powered automatic bookkeeping bot.

**Core Experience:**
- **Automatic CLI Guidance:** Guided setup via CLI upon the first `npm start`, automatically writing to `.env`.
- **Seamless Setup:** Automatically validates Feishu permissions and creates the Bitable (on first run).
- **Real-time Interaction:** Receives images/PDFs via Feishu bot through a WebSocket long connection.
- **Intelligent Matching:** Automatically pairs screenshots with invoices based on the amount and writes the data to the Bitable upon success.
- **Human-in-the-Loop:** Automatically sends reminders for unmatched entries after a timeout.

---

## 1. Requirements

- Node.js `>= 20`
- npm `>= 9`
- A Feishu Custom App (Bot)
- OpenRouter API Key

---

## 2. Installation

```bash
npm install
```

---

## 3. Feishu App Configuration (Required)

Create a custom app on the Feishu Open Platform and enable Bot capabilities.

It is recommended to grant at least the following permissions (add others as needed based on actual interfaces):
- `im:message`
- `drive:drive`
- `bitable:app`

Install the app to your company/team and ensure the bot can send and receive messages in the target session.

---

## 4. First Launch (Automatic Initialization)

```bash
npm start
```

If no `.env` file exists, a CLI wizard will automatically appear and ask for:
- `OpenRouter API Key`
- `Feishu App ID`
- `Feishu App Secret`

After saving, the program will automatically:
1. Validate Feishu permissions.
2. Check for or create the `AI Automatic Accounting Book` (Bitable).
3. Check for or create the `Bookkeeping Details` (Table).
4. Automatically initialize fields:
   - `Date`
   - `Amount`
   - `Invoice` (Attachment)
   - `Order Screenshot` (Attachment)

Once successful, the terminal will display the Bitable link and enter WebSocket listening mode.

---

## 5. Development Commands

```bash
# Development mode (run src directly)
npm run dev

# Build (TypeScript -> dist)
npm run build

# Automated tests
npm test

# Batch backfill (processes the ./pending directory by default)
npm run batch

# Specify any directory for batch matching and archiving
npm run dev -- --batch-dir ./your-folder
```

---

## 6. Tutorial

1. Send a payment screenshot (image) to the bot in Feishu.
2. The bot will reply: "Received, identifying..."
3. Send the corresponding PDF invoice.
4. Once the system matches them by amount, it will automatically write to the table and send a success confirmation card.
5. For entries that remain unmatched after a timeout, a reminder card will be sent.

**Batch Backfill Mode:**
1. Place unmatched screenshots and PDFs in the same directory (subdirectories are supported).
2. Execute `npm run dev -- --batch-dir ./pending`.
3. The program uses VLM to identify screenshot amounts, parses PDF amounts, and pairs them.
4. Successful matches are written to the same row in the Feishu Bitable (Date/Amount/Invoice/Screenshot).
5. The terminal outputs a list of unmatched items for manual follow-up.

---

## 7. Configuration Details (`.env`)

Refer to `.env.example`:

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

**Notes:**
- `LARK_BASE_TOKEN` / `LARK_TABLE_ID` will be automatically backfilled after the initial setup.
- `UNMATCHED_REMINDER_MINUTES` controls the timing for unmatched reminders.

---

## 8. Project Structure

```text
src/
├─ index.ts                 # Entry point (CLI + Init + WS Start)
├─ cli/                     # First-time setup guidance
├─ config/                  # Environment variables and constants
├─ lark/                    # Feishu API / WebSocket / Message Cards
├─ agent/                   # PDF parsing and matching pool
├─ services/                # OpenRouter and business orchestration
├─ types/                   # Type definitions
└─ utils/                   # Utilities (e.g., amount formatting)
```

---

## 9. Deployment Suggestions

The program can be deployed as a long-running Node process (e.g., using PM2, systemd, or Docker).

**Simplest method (PM2):**
```bash
npm run build
pm2 start "node dist/index.js" --name accounting-tool
pm2 save
```

---

## 10. FAQ

- **Not receiving Feishu messages after launch**  
  Check if the app is published and installed in the company, if the bot is visible in the session, and if Event Subscriptions are enabled.

- **Messages received but Bitable write fails**  
  Ensure the app has `bitable` and `drive` permissions and that the target Bitable is accessible.

- **Amount recognition discrepancies**  
  Try changing the `OPENROUTER_VLM_MODEL` or strengthen the prompt constraints for image recognition (e.g., "Extract only the actual amount paid").
