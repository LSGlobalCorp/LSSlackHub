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

  await sheets.spreadsheets.values.clear({ spreadsheetId: auth.sheet_id, range: "'Activity Log'!A:Z" });
  await sheets.spreadsheets.values.update({
    spreadsheetId: auth.sheet_id,
    range: "'Activity Log'!A1:G1",
    valueInputOption: "RAW",
    requestBody: { values: [["Date", "Time", "Agent ID", "Channel", "Customer ID", "Answered", "Transferred"]] },
  });

  const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId: auth.sheet_id });
  const tab = spreadsheet.data.sheets?.find(s => s.properties?.title === "Activity Log");
  if (tab) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: auth.sheet_id,
      requestBody: {
        requests: [
          { repeatCell: { range: { sheetId: tab.properties?.sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 7 }, cell: { userEnteredFormat: { textFormat: { bold: true } } }, fields: "userEnteredFormat.textFormat.bold" } },
          { setBasicFilter: { filter: { range: { sheetId: tab.properties?.sheetId, startRowIndex: 0, startColumnIndex: 0, endColumnIndex: 7 } } } },
        ],
      },
    });
  }

  console.log("Done: Date | Time | Agent ID | Channel | Customer ID | Answered | Transferred");
  await pool.end();
}

main().catch((err) => { console.error("Error:", err.message); process.exit(1); });
