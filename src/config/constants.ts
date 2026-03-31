export const REQUIRED_ENV_KEYS = ["OPENROUTER_API_KEY", "LARK_APP_ID", "LARK_APP_SECRET"] as const;

export const DEFAULT_BASE_NAME = "AI自动记账本";
export const DEFAULT_TABLE_NAME = "记账明细";

export const DEFAULT_UNMATCHED_REMINDER_MINUTES = 120;

export const ACCOUNTING_FIELDS = [
  { field_name: "日期", type: 5 },
  { field_name: "金额", type: 2 },
  { field_name: "发票", type: 17 },
  { field_name: "订单截图", type: 17 }
] as const;
