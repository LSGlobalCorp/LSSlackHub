import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { Pool } from "pg";
import { WebClient } from "@slack/web-api";
import crypto from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;

function encrypt(plaintext: string): string {
  const key = Buffer.from(process.env.ENCRYPTION_KEY!, "hex");
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  let encrypted = cipher.update(plaintext, "utf8", "hex");
  encrypted += cipher.final("hex");
  const authTag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted}`;
}

async function main() {
  const botToken = process.env.SLACK_BOT_TOKEN;
  if (!botToken) {
    console.error("SLACK_BOT_TOKEN not set");
    process.exit(1);
  }

  // Get team info from Slack API
  const client = new WebClient(botToken);
  const authResult = await client.auth.test();

  console.log("Slack auth info:");
  console.log("  Team:", authResult.team, `(${authResult.team_id})`);
  console.log("  Bot User:", authResult.user_id);

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  // Check if workspace already exists
  const existing = await pool.query(
    "SELECT id FROM workspaces WHERE slack_team_id = $1",
    [authResult.team_id]
  );

  if (existing.rows.length > 0) {
    console.log("\nWorkspace already exists:", existing.rows[0].id);
    await pool.end();
    return;
  }

  // Insert workspace
  const encryptedToken = encrypt(botToken);
  const result = await pool.query(
    `INSERT INTO workspaces (slack_team_id, team_name, encrypted_bot_token, bot_user_id, installed_by, is_active)
     VALUES ($1, $2, $3, $4, $5, true)
     RETURNING id`,
    [authResult.team_id, authResult.team, encryptedToken, authResult.user_id, authResult.user_id]
  );

  console.log("\nWorkspace created:", result.rows[0].id);
  console.log("Team ID:", authResult.team_id);
  console.log("Team Name:", authResult.team);

  await pool.end();
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
