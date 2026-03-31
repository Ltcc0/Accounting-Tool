export function buildArchivedSuccessCard(amount: number): Record<string, unknown> {
  return {
    config: { wide_screen_mode: true },
    header: {
      title: { tag: "plain_text", content: "✅ 记账归档成功！" },
      template: "green"
    },
    elements: [
      {
        tag: "markdown",
        content: `金额: **¥ ${amount.toFixed(2)}**\n已成功写入多维表格。`
      }
    ]
  };
}

export function buildUnmatchedReminderCard(amount: number): Record<string, unknown> {
  return {
    config: { wide_screen_mode: true },
    header: {
      title: { tag: "plain_text", content: "⚠️ 待补发票提醒" },
      template: "yellow"
    },
    elements: [
      {
        tag: "markdown",
        content: `您有一笔 **¥ ${amount.toFixed(2)}** 的记录尚未归档，因为没有收到对应附件。`
      },
      {
        tag: "action",
        actions: [
          {
            tag: "button",
            text: { tag: "plain_text", content: "回复此卡片上传发票" },
            type: "primary",
            value: { action: "upload_invoice" }
          },
          {
            tag: "button",
            text: { tag: "plain_text", content: "作废此记录" },
            type: "default",
            value: { action: "void_record" }
          }
        ]
      }
    ]
  };
}

