import { google } from "googleapis";
import { query } from "../db/client";
import { encrypt, decrypt } from "../utils/crypto";
import { logger } from "../utils/logger";

// --- OAuth ---

function getOAuth2Client() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
}

export function getAuthUrl(teamId: string, channelId?: string): string {
  const client = getOAuth2Client();
  const state = channelId ? `${teamId}:${channelId}` : teamId;
  return client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: [
      "https://www.googleapis.com/auth/spreadsheets",
      "https://www.googleapis.com/auth/drive.file",
    ],
    state,
  });
}

export async function handleGoogleCallback(code: string, teamId: string): Promise<string> {
  const client = getOAuth2Client();
  const { tokens } = await client.getToken(code);

  if (!tokens.access_token || !tokens.refresh_token) {
    throw new Error("Missing tokens from Google OAuth response");
  }

  const encryptedAccess = encrypt(tokens.access_token);
  const encryptedRefresh = encrypt(tokens.refresh_token);
  const expiry = new Date(tokens.expiry_date || Date.now() + 3600000);

  const wsResult = await query(
    "SELECT id, team_name FROM workspaces WHERE slack_team_id = $1 AND is_active = true",
    [teamId]
  );
  const workspace = wsResult.rows[0];
  if (!workspace) throw new Error(`Workspace not found for team ${teamId}`);

  client.setCredentials(tokens);
  const sheets = google.sheets({ version: "v4", auth: client });

  const spreadsheet = await sheets.spreadsheets.create({
    requestBody: {
      properties: { title: `LS Agent Hub - ${workspace.team_name}` },
      sheets: [
        {
          properties: { title: "Activity Log", index: 0 },
          data: [{
            startRow: 0, startColumn: 0,
            rowData: [{
              values: ["Date", "Time", "Agent ID", "Channel", "Customer ID", "Answered", "Transferred"]
                .map((h) => ({ userEnteredValue: { stringValue: h }, userEnteredFormat: { textFormat: { bold: true } } })),
            }],
          }],
        },
        {
          properties: { title: "Daily Summary", index: 1 },
          data: [{
            startRow: 0, startColumn: 0,
            rowData: [{
              values: ["Date", "Total Actions", "Answers", "Transfers", "Escalations", "Holds", "Other"]
                .map((h) => ({ userEnteredValue: { stringValue: h }, userEnteredFormat: { textFormat: { bold: true } } })),
            }],
          }],
        },
        {
          properties: { title: "Agent Performance", index: 2 },
          data: [{
            startRow: 0, startColumn: 0,
            rowData: [{
              values: ["Date", "Agent", "Total", "Answers", "Transfers", "Escalations", "Holds", "Other", "Top Channel"]
                .map((h) => ({ userEnteredValue: { stringValue: h }, userEnteredFormat: { textFormat: { bold: true } } })),
            }],
          }],
        },
      ],
    },
  });

  const sheetId = spreadsheet.data.spreadsheetId!;

  // Add auto-filters to all tabs
  const sheetTabs = spreadsheet.data.sheets || [];
  const filterRequests = sheetTabs.map((tab) => ({
    setBasicFilter: {
      filter: {
        range: {
          sheetId: tab.properties?.sheetId,
          startRowIndex: 0,
          startColumnIndex: 0,
          endColumnIndex: (tab.properties?.title === "Agent Performance" ? 9
            : tab.properties?.title === "Activity Log" ? 7 : 7),
        },
      },
    },
  }));

  try {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: sheetId,
      requestBody: { requests: filterRequests },
    });
  } catch (err) {
    logger.warn("Failed to set auto-filters on sheet", {
      error: err instanceof Error ? err.message : "Unknown",
    });
  }

  await query(
    `INSERT INTO google_auth (workspace_id, encrypted_access_token, encrypted_refresh_token, sheet_id, token_expiry)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (workspace_id) DO UPDATE SET
       encrypted_access_token = EXCLUDED.encrypted_access_token,
       encrypted_refresh_token = EXCLUDED.encrypted_refresh_token,
       sheet_id = EXCLUDED.sheet_id,
       token_expiry = EXCLUDED.token_expiry,
       updated_at = NOW()`,
    [workspace.id, encryptedAccess, encryptedRefresh, sheetId, expiry.toISOString()]
  );

  logger.info("Google Sheets connected", { teamId, sheetId });
  return sheetId;
}

// --- Authenticated Sheets Client ---

async function getAuthenticatedSheetsClient(workspaceId: string) {
  const result = await query("SELECT * FROM google_auth WHERE workspace_id = $1", [workspaceId]);
  const auth = result.rows[0];
  if (!auth) return null;

  const client = getOAuth2Client();
  const accessToken = decrypt(auth.encrypted_access_token);
  const refreshToken = decrypt(auth.encrypted_refresh_token);

  client.setCredentials({
    access_token: accessToken,
    refresh_token: refreshToken,
    expiry_date: new Date(auth.token_expiry).getTime(),
  });

  if (new Date(auth.token_expiry) <= new Date()) {
    try {
      const { credentials } = await client.refreshAccessToken();
      const newEncryptedAccess = encrypt(credentials.access_token!);
      const newExpiry = new Date(credentials.expiry_date || Date.now() + 3600000);
      await query(
        `UPDATE google_auth SET encrypted_access_token = $1, token_expiry = $2, updated_at = NOW() WHERE workspace_id = $3`,
        [newEncryptedAccess, newExpiry.toISOString(), workspaceId]
      );
    } catch (err) {
      logger.error("Failed to refresh Google token", {
        workspaceId, error: err instanceof Error ? err.message : "Unknown",
      });
      return null;
    }
  }

  return { sheets: google.sheets({ version: "v4", auth: client }), sheetId: auth.sheet_id as string };
}

// --- Batched Write Buffer ---

export interface ActivityRowData {
  date: string;
  time: string;
  agentId: string;
  channelName: string;
  customerId: string;
  answered: number;
  transferred: number;
}

export function formatActivityRow(data: ActivityRowData): string[] {
  return [
    data.date, data.time, data.agentId, data.channelName,
    data.customerId, String(data.answered), String(data.transferred),
  ];
}

const writeBuffer: Map<string, string[][]> = new Map();

export function appendActivityRow(workspaceId: string, data: ActivityRowData): void {
  const row = formatActivityRow(data);
  const existing = writeBuffer.get(workspaceId) || [];
  existing.push(row);
  writeBuffer.set(workspaceId, existing);

  if (existing.length >= 20) {
    flushBuffer(workspaceId).catch((err) => {
      logger.error("Failed to flush write buffer", {
        workspaceId, error: err instanceof Error ? err.message : "Unknown",
      });
    });
  }
}

export async function flushBuffer(workspaceId?: string): Promise<void> {
  const workspaces = workspaceId ? [workspaceId] : Array.from(writeBuffer.keys());

  for (const wsId of workspaces) {
    const rows = writeBuffer.get(wsId);
    if (!rows || rows.length === 0) continue;

    writeBuffer.set(wsId, []);

    try {
      const client = await getAuthenticatedSheetsClient(wsId);
      if (!client) {
        logger.warn("No Google Sheets connection, skipping flush", { workspaceId: wsId });
        continue;
      }

      await client.sheets.spreadsheets.values.append({
        spreadsheetId: client.sheetId,
        range: "'Activity Log'!A:G",
        valueInputOption: "USER_ENTERED",
        requestBody: { values: rows },
      });

      logger.info("Flushed activity rows to Google Sheets", { workspaceId: wsId, rowCount: rows.length });
    } catch (err) {
      logger.error("Failed to write to Google Sheets", {
        workspaceId: wsId, error: err instanceof Error ? err.message : "Unknown", rowCount: rows.length,
      });
      const current = writeBuffer.get(wsId) || [];
      writeBuffer.set(wsId, [...rows, ...current]);
    }
  }
}

// --- Summary Writes ---

export async function writeDailySummaryRow(workspaceId: string, row: string[]): Promise<void> {
  const client = await getAuthenticatedSheetsClient(workspaceId);
  if (!client) return;
  await client.sheets.spreadsheets.values.append({
    spreadsheetId: client.sheetId,
    range: "'Daily Summary'!A:G",
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [row] },
  });
}

export async function writeAgentPerformanceRows(workspaceId: string, rows: string[][]): Promise<void> {
  const client = await getAuthenticatedSheetsClient(workspaceId);
  if (!client) return;
  await client.sheets.spreadsheets.values.append({
    spreadsheetId: client.sheetId,
    range: "'Agent Performance'!A:I",
    valueInputOption: "USER_ENTERED",
    requestBody: { values: rows },
  });
}

// --- Set Sheet ID ---

export async function setSheetId(workspaceId: string, sheetId: string): Promise<boolean> {
  const result = await query(
    "UPDATE google_auth SET sheet_id = $1, updated_at = NOW() WHERE workspace_id = $2",
    [sheetId, workspaceId]
  );
  if (result.rowCount === 0) return false;
  logger.info("Sheet ID updated", { workspaceId, sheetId });
  return true;
}

// --- Disconnect ---

export async function disconnectSheets(workspaceId: string): Promise<void> {
  await query("DELETE FROM google_auth WHERE workspace_id = $1", [workspaceId]);
  writeBuffer.delete(workspaceId);
  logger.info("Google Sheets disconnected", { workspaceId });
}

// --- Periodic Flush ---

let flushInterval: ReturnType<typeof setInterval> | null = null;

export function startPeriodicFlush(intervalMs = 10000): void {
  if (flushInterval) return;
  flushInterval = setInterval(() => {
    flushBuffer().catch((err) => {
      logger.error("Periodic flush error", { error: err instanceof Error ? err.message : "Unknown" });
    });
  }, intervalMs);
}

export function stopPeriodicFlush(): void {
  if (flushInterval) {
    clearInterval(flushInterval);
    flushInterval = null;
  }
}
