export interface ParseContext {
  text: string;           // cleaned message text (mentions stripped)
  senderId: string;       // Slack user ID of whoever typed the message
  channelId: string;      // Slack channel ID
  channelName: string;    // resolved channel name + ID
  workspaceId: string;    // DB workspace UUID
  messageTs: string;      // Slack message timestamp
}

export interface ParseResult {
  matched: boolean;
  reaction?: string;      // emoji name to react with
}

export interface Parser {
  name: string;
  description: string;
  match(text: string): boolean;
  execute(ctx: ParseContext): Promise<ParseResult>;
}
