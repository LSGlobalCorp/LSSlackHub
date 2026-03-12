import { WebClient } from "@slack/web-api";
import { query } from "../db/client";
import { getDecryptedToken, getWorkspaceByTeamId } from "./workspace";
import { logger } from "../utils/logger";

const RATE_LIMIT_DELAY_MS = 1100; // Slightly over 1 second for Tier 1 methods

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getSlackClient(teamId: string): Promise<WebClient> {
  const token = await getDecryptedToken(teamId);
  if (!token) throw new Error(`No token found for workspace ${teamId}`);
  return new WebClient(token);
}

export async function syncChannels(teamId: string): Promise<number> {
  const client = await getSlackClient(teamId);
  const workspace = await getWorkspaceByTeamId(teamId);
  if (!workspace) throw new Error(`Workspace not found: ${teamId}`);

  let cursor: string | undefined;
  let totalSynced = 0;

  do {
    const result = await client.conversations.list({
      types: "public_channel,private_channel",
      limit: 200,
      cursor,
    });

    if (result.channels) {
      for (const channel of result.channels) {
        await query(
          `INSERT INTO channels (workspace_id, slack_channel_id, name, is_private, member_count, synced_at)
           VALUES ($1, $2, $3, $4, $5, NOW())
           ON CONFLICT (workspace_id, slack_channel_id)
           DO UPDATE SET name = EXCLUDED.name, is_private = EXCLUDED.is_private, member_count = EXCLUDED.member_count, synced_at = NOW()`,
          [workspace.id, channel.id, channel.name, channel.is_private || false, channel.num_members || 0]
        );
        totalSynced++;
      }
    }

    cursor = result.response_metadata?.next_cursor || undefined;
    if (cursor) await sleep(RATE_LIMIT_DELAY_MS);
  } while (cursor);

  logger.info("Channels synced", { teamId, count: totalSynced });
  return totalSynced;
}

export async function syncUsers(teamId: string): Promise<number> {
  const client = await getSlackClient(teamId);
  const workspace = await getWorkspaceByTeamId(teamId);
  if (!workspace) throw new Error(`Workspace not found: ${teamId}`);

  let cursor: string | undefined;
  let totalSynced = 0;

  do {
    const result = await client.users.list({ limit: 200, cursor });

    if (result.members) {
      for (const user of result.members) {
        if (user.is_bot || user.id === "USLACKBOT") continue;

        await query(
          `INSERT INTO users (workspace_id, slack_user_id, display_name, email, is_admin, synced_at)
           VALUES ($1, $2, $3, $4, $5, NOW())
           ON CONFLICT (workspace_id, slack_user_id)
           DO UPDATE SET display_name = EXCLUDED.display_name, email = EXCLUDED.email, is_admin = EXCLUDED.is_admin, synced_at = NOW()`,
          [
            workspace.id,
            user.id,
            user.profile?.display_name || user.real_name || user.name,
            user.profile?.email || null,
            user.is_admin || false,
          ]
        );
        totalSynced++;
      }
    }

    cursor = result.response_metadata?.next_cursor || undefined;
    if (cursor) await sleep(RATE_LIMIT_DELAY_MS);
  } while (cursor);

  logger.info("Users synced", { teamId, count: totalSynced });
  return totalSynced;
}

export async function syncMessages(
  teamId: string,
  channelId: string,
  limit: number = 100
): Promise<number> {
  const client = await getSlackClient(teamId);
  const workspace = await getWorkspaceByTeamId(teamId);
  if (!workspace) throw new Error(`Workspace not found: ${teamId}`);

  let totalSynced = 0;

  try {
    const result = await client.conversations.history({
      channel: channelId,
      limit,
    });

    if (result.messages) {
      for (const msg of result.messages) {
        if (!msg.ts) continue;

        await query(
          `INSERT INTO messages (workspace_id, channel_slack_id, user_slack_id, text, ts, thread_ts, synced_at)
           VALUES ($1, $2, $3, $4, $5, $6, NOW())
           ON CONFLICT (workspace_id, channel_slack_id, ts) DO NOTHING`,
          [workspace.id, channelId, msg.user || null, msg.text || "", msg.ts, msg.thread_ts || null]
        );
        totalSynced++;
      }
    }
  } catch (err: unknown) {
    const error = err as { data?: { error?: string } };
    if (error.data?.error === "not_in_channel") {
      logger.warn("Bot not in channel, skipping", { teamId, channelId });
    } else {
      throw err;
    }
  }

  logger.info("Messages synced", { teamId, channelId, count: totalSynced });
  return totalSynced;
}

export async function syncAll(teamId: string): Promise<{
  channels: number;
  users: number;
}> {
  logger.info("Starting full sync", { teamId });

  const channels = await syncChannels(teamId);
  const users = await syncUsers(teamId);

  logger.info("Full sync complete", { teamId, channels, users });
  return { channels, users };
}
