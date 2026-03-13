import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { google } from "googleapis";
import { Pool } from "pg";
import crypto from "crypto";

function decrypt(encryptedText: string): string {
  const key = Buffer.from(process.env.ENCRYPTION_KEY!, "hex");
  const [ivHex, authTagHex, ciphertext] = encryptedText.split(":");
  const iv = Buffer.from(ivHex, "hex");
  const authTag = Buffer.from(authTagHex, "hex");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);
  let decrypted = decipher.update(ciphertext, "hex", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  const result = await pool.query("SELECT * FROM google_auth LIMIT 1");
  const auth = result.rows[0];

  const client = new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET, process.env.GOOGLE_REDIRECT_URI);
  client.setCredentials({ access_token: decrypt(auth.encrypted_access_token), refresh_token: decrypt(auth.encrypted_refresh_token) });
  const sheets = google.sheets({ version: "v4", auth: client });

  // Read Activity Log
  const activityLog = await sheets.spreadsheets.values.get({
    spreadsheetId: auth.sheet_id,
    range: "'Activity Log'!A1:G20",
  });
  console.log("=== Activity Log ===");
  (activityLog.data.values || []).forEach((row, i) => console.log(`Row ${i + 1}: ${JSON.stringify(row)}`));

  // Read Dashboard rendered values
  const dashRendered = await sheets.spreadsheets.values.get({
    spreadsheetId: auth.sheet_id,
    range: "'Dashboard'!A1:J20",
    valueRenderOption: "FORMATTED_VALUE",
  });
  console.log("\n=== Dashboard (rendered) ===");
  (dashRendered.data.values || []).forEach((row, i) => console.log(`Row ${i + 1}: ${JSON.stringify(row)}`));

  await pool.end();
}

main().catch((err) => { console.error("Error:", err.message); process.exit(1); });
