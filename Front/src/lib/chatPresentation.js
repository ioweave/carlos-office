export const formatChatTime = value => {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString();
};

export const conversationTitle = conversation => {
  const saved = conversation?.title?.trim();
  if (saved) return saved;
  const preview = conversation?.firstCarlosPreview?.trim()
    || conversation?.messages?.find(message => message.actor === "Carlos")?.content?.replace(/\s+/g, " ").trim().slice(0, 56);
  return preview || "New conversation";
};

export const sortConversationSummaries = items => [...(items || [])].sort((left, right) => (
  String(right.lastMessageAt || right.messages?.at(-1)?.at || "")
    .localeCompare(String(left.lastMessageAt || left.messages?.at(-1)?.at || ""))
));
