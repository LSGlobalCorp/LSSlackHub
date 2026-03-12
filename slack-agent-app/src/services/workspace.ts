import { query } from "../db/client";
import { encrypt, decrypt } from "../utils/crypto";
import { logger } from "../utils/logger";
import { Workspace } from "../types";

export async function createWorkspace(
  teamId: string,
  teamName: string,
  botToken: string,
  botUserId: string,
  installedBy: string
): Promise<Workspace> {
  const encryptedToken = encrypt(botToken);

  const result = await query(
    `INSERT INTO workspaces (slack_team_id, team_name, encrypted_bot_token, bot_user_id, installed_by)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (slack_team_id)
     DO UPDATE SET
       team_name = EXCLUDED.team_name,
       encrypted_bot_token = EXCLUDED.encrypted_bot_token,
       bot_user_id = EXCLUDED.bot_user_id,
       installed_by = EXCLUDED.installed_by,
       installed_at = NOW(),
       is_active = true
     RETURNING *`,
    [teamId, teamName, encryptedToken, botUserId, installedBy]
  );

  logger.info("Workspace created/updated", { teamId, teamName });
  return result.rows[0];
}

export async function getWorkspaceByTeamId(teamId: string): Promise<Workspace | null> {
  const result = await query(
    "SELECT * FROM workspaces WHERE slack_team_id = $1 AND is_active = true",
    [teamId]
  );
  return result.rows[0] || null;
}

export async function getDecryptedToken(teamId: string): Promise<string | null> {
  const workspace = await getWorkspaceByTeamId(teamId);
  if (!workspace) return null;
  return decrypt(workspace.encrypted_bot_token);
}

export async function deactivateWorkspace(teamId: string): Promise<void> {
  await query(
    "UPDATE workspaces SET is_active = false WHERE slack_team_id = $1",
    [teamId]
  );
  logger.info("Workspace deactivated", { teamId });
}

export async function listActiveWorkspaces(): Promise<Workspace[]> {
  const result = await query("SELECT * FROM workspaces WHERE is_active = true");
  return result.rows;
}
