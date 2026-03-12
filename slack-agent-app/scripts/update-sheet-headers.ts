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
  if (result.rows.length === 0) { console.log("No sheet found"); await pool.end(); return; }

  const auth = result.rows[0];
  const client = new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET, process.env.GOOGLE_REDIRECT_URI);
  client.setCredentials({ access_token: decrypt(auth.encrypted_access_token), refresh_token: decrypt(auth.encrypted_refresh_token) });

  const sheets = google.sheets({ version: "v4", auth: client });

  // Update Activity Log headers
  await sheets.spreadsheets.values.update({
    spreadsheetId: auth.sheet_id,
    range: "'Activity Log'!A1:F1",
    valueInputOption: "RAW",
    requestBody: { values: [["Date", "Time", "Agent Name", "Channel", "Answered", "Transfer"]] },
  });

  // Clear old data columns G and H (old Notes/Confidence)
  await sheets.spreadsheets.values.clear({
    spreadsheetId: auth.sheet_id,
    range: "'Activity Log'!G:H",
  });

  console.log("Sheet headers updated to: Date | Time | Agent Name | Channel | Answered | Transfer");
  console.log("Old columns G-H cleared");

  // Also clear old data rows since they have the old format
  const existing = await sheets.spreadsheets.values.get({
    spreadsheetId: auth.sheet_id,
    range: "'Activity Log'!A2:F",
  });
  if (existing.data.values && existing.data.values.length > 0) {
    console.log(`Note: ${existing.data.values.length} old rows exist with previous format. You may want to clear them.`);
  }

  await pool.end();
}

main().catch((err) => { console.error("Error:", err.message); process.exit(1); });
