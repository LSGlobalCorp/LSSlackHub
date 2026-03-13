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
  if (!auth) { console.log("No Google Sheets connection"); await pool.end(); return; }

  const client = new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET, process.env.GOOGLE_REDIRECT_URI);
  client.setCredentials({ access_token: decrypt(auth.encrypted_access_token), refresh_token: decrypt(auth.encrypted_refresh_token) });
  const sheets = google.sheets({ version: "v4", auth: client });

  const spreadsheetId = auth.sheet_id;

  // Check if Dashboard tab already exists
  const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId });
  const existingDashboard = spreadsheet.data.sheets?.find(s => s.properties?.title === "Dashboard");

  if (existingDashboard) {
    // Delete existing dashboard to recreate it
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [{ deleteSheet: { sheetId: existingDashboard.properties?.sheetId } }],
      },
    });
    console.log("Removed old Dashboard tab");
  }

  // Add Dashboard tab at index 0 (first tab)
  const addResult = await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        {
          addSheet: {
            properties: { title: "Dashboard", index: 0 },
          },
        },
      ],
    },
  });

  const dashboardSheetId = addResult.data.replies?.[0]?.addSheet?.properties?.sheetId;

  // Set column widths
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        // Column A - labels (200px)
        { updateDimensionProperties: { range: { sheetId: dashboardSheetId, dimension: "COLUMNS", startIndex: 0, endIndex: 1 }, properties: { pixelSize: 200 }, fields: "pixelSize" } },
        // Column B - values (150px)
        { updateDimensionProperties: { range: { sheetId: dashboardSheetId, dimension: "COLUMNS", startIndex: 1, endIndex: 2 }, properties: { pixelSize: 150 }, fields: "pixelSize" } },
        // Columns C-H for filtered results table (120px each)
        { updateDimensionProperties: { range: { sheetId: dashboardSheetId, dimension: "COLUMNS", startIndex: 2, endIndex: 3 }, properties: { pixelSize: 30 }, fields: "pixelSize" } },
        { updateDimensionProperties: { range: { sheetId: dashboardSheetId, dimension: "COLUMNS", startIndex: 3, endIndex: 9 }, properties: { pixelSize: 140 }, fields: "pixelSize" } },
      ],
    },
  });

  // Write Dashboard content with formulas
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: "'Dashboard'!A1:J50",
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [
        // Header
        ["📊 Activity Dashboard", "", "", "", "", "", "", "", "", ""],
        ["", "", "", "", "", "", "", "", "", ""],
        // Filters
        ["FILTERS", "", "", "", "", "", "", "", "", ""],
        ["Select Date:", "", "", "", "", "", "", "", "", ""],
        ["Select Agent ID:", "", "", "", "", "", "", "", "", ""],
        ["", "", "", "", "", "", "", "", "", ""],
        // Summary stats
        ["SUMMARY FOR SELECTED FILTERS", "", "", "", "", "", "", "", "", ""],
        ["Total Records:", '=IF(AND(B4="",B5=""), COUNTA(\'Activity Log\'!A2:A), SUMPRODUCT((IF(B4="",TRUE,TEXT(\'Activity Log\'!A2:A,"YYYY-MM-DD")=TEXT(B4,"YYYY-MM-DD")))*(IF(B5="",TRUE,\'Activity Log\'!C2:C=B5))*1))', "", "", "", "", "", "", "", ""],
        ["Total Answered:", '=IF(AND(B4="",B5=""), SUM(\'Activity Log\'!F2:F), SUMPRODUCT((IF(B4="",TRUE,TEXT(\'Activity Log\'!A2:A,"YYYY-MM-DD")=TEXT(B4,"YYYY-MM-DD")))*(IF(B5="",TRUE,\'Activity Log\'!C2:C=B5))*(\'Activity Log\'!F2:F)))', "", "", "", "", "", "", "", ""],
        ["Total Transferred:", '=IF(AND(B4="",B5=""), SUM(\'Activity Log\'!G2:G), SUMPRODUCT((IF(B4="",TRUE,TEXT(\'Activity Log\'!A2:A,"YYYY-MM-DD")=TEXT(B4,"YYYY-MM-DD")))*(IF(B5="",TRUE,\'Activity Log\'!C2:C=B5))*(\'Activity Log\'!G2:G)))', "", "", "", "", "", "", "", ""],
        ["", "", "", "", "", "", "", "", "", ""],
        // Filtered data table
        ["FILTERED ACTIVITY LOG", "", "", "", "", "", "", "", "", ""],
        ["Date", "Time", "Agent ID", "Channel", "Customer ID", "Answered", "Transferred", "", "", ""],
        // Dynamic filter - FILTER preserves original cell formatting (no SORT to avoid type coercion)
        ['=IFERROR(FILTER(\'Activity Log\'!A2:G, IF(B4="",\'Activity Log\'!A2:A<>"",TEXT(\'Activity Log\'!A2:A,"YYYY-MM-DD")=TEXT(B4,"YYYY-MM-DD")), IF(B5="",\'Activity Log\'!A2:A<>"",\'Activity Log\'!C2:C=B5)),"No matching records")', "", "", "", "", "", "", "", "", ""],
      ],
    },
  });

  // Write the unique dates and agents lists for data validation (in hidden columns)
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: "'Dashboard'!K1:L2",
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [
        ["Dates", "Agents"],
        ['=SORT(UNIQUE(\'Activity Log\'!A2:A),1,FALSE)', '=SORT(UNIQUE(\'Activity Log\'!C2:C))'],
      ],
    },
  });

  // Format the dashboard
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        // Title - large bold
        { repeatCell: { range: { sheetId: dashboardSheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 1 }, cell: { userEnteredFormat: { textFormat: { bold: true, fontSize: 16 } } }, fields: "userEnteredFormat.textFormat" } },
        // Section headers - bold with background
        ...[2, 6, 11].map(row => ({
          repeatCell: {
            range: { sheetId: dashboardSheetId, startRowIndex: row, endRowIndex: row + 1, startColumnIndex: 0, endColumnIndex: 9 },
            cell: { userEnteredFormat: { textFormat: { bold: true, fontSize: 11 }, backgroundColor: { red: 0.85, green: 0.92, blue: 0.98 } } },
            fields: "userEnteredFormat.textFormat,userEnteredFormat.backgroundColor",
          },
        })),
        // Filter labels - bold
        ...[3, 4].map(row => ({
          repeatCell: {
            range: { sheetId: dashboardSheetId, startRowIndex: row, endRowIndex: row + 1, startColumnIndex: 0, endColumnIndex: 1 },
            cell: { userEnteredFormat: { textFormat: { bold: true } } },
            fields: "userEnteredFormat.textFormat",
          },
        })),
        // Filter value cells - bordered with light yellow background
        ...[3, 4].map(row => ({
          repeatCell: {
            range: { sheetId: dashboardSheetId, startRowIndex: row, endRowIndex: row + 1, startColumnIndex: 1, endColumnIndex: 2 },
            cell: {
              userEnteredFormat: {
                backgroundColor: { red: 1, green: 1, blue: 0.9 },
                borders: {
                  top: { style: "SOLID", color: { red: 0.6, green: 0.6, blue: 0.6 } },
                  bottom: { style: "SOLID", color: { red: 0.6, green: 0.6, blue: 0.6 } },
                  left: { style: "SOLID", color: { red: 0.6, green: 0.6, blue: 0.6 } },
                  right: { style: "SOLID", color: { red: 0.6, green: 0.6, blue: 0.6 } },
                },
              },
            },
            fields: "userEnteredFormat.backgroundColor,userEnteredFormat.borders",
          },
        })),
        // Summary values - bold numbers
        ...[7, 8, 9].map(row => ({
          repeatCell: {
            range: { sheetId: dashboardSheetId, startRowIndex: row, endRowIndex: row + 1, startColumnIndex: 1, endColumnIndex: 2 },
            cell: { userEnteredFormat: { textFormat: { bold: true, fontSize: 12 } } },
            fields: "userEnteredFormat.textFormat",
          },
        })),
        // Table headers - bold with border
        {
          repeatCell: {
            range: { sheetId: dashboardSheetId, startRowIndex: 12, endRowIndex: 13, startColumnIndex: 0, endColumnIndex: 7 },
            cell: { userEnteredFormat: { textFormat: { bold: true }, backgroundColor: { red: 0.9, green: 0.9, blue: 0.9 } } },
            fields: "userEnteredFormat.textFormat,userEnteredFormat.backgroundColor",
          },
        },
        // Data validation for Date (B4) - dropdown from unique dates
        {
          setDataValidation: {
            range: { sheetId: dashboardSheetId, startRowIndex: 3, endRowIndex: 4, startColumnIndex: 1, endColumnIndex: 2 },
            rule: {
              condition: { type: "ONE_OF_RANGE", values: [{ userEnteredValue: "='Dashboard'!K2:K" }] },
              showCustomUi: true,
              strict: false,
            },
          },
        },
        // Data validation for Agent ID (B5) - dropdown from unique agents
        {
          setDataValidation: {
            range: { sheetId: dashboardSheetId, startRowIndex: 4, endRowIndex: 5, startColumnIndex: 1, endColumnIndex: 2 },
            rule: {
              condition: { type: "ONE_OF_RANGE", values: [{ userEnteredValue: "='Dashboard'!L2:L" }] },
              showCustomUi: true,
              strict: false,
            },
          },
        },
        // Format date column (A14:A200) as YYYY-MM-DD
        { repeatCell: { range: { sheetId: dashboardSheetId, startRowIndex: 13, endRowIndex: 200, startColumnIndex: 0, endColumnIndex: 1 }, cell: { userEnteredFormat: { numberFormat: { type: "DATE", pattern: "yyyy-mm-dd" } } }, fields: "userEnteredFormat.numberFormat" } },
        // Format time column (B14:B200) as HH:MM:SS
        { repeatCell: { range: { sheetId: dashboardSheetId, startRowIndex: 13, endRowIndex: 200, startColumnIndex: 1, endColumnIndex: 2 }, cell: { userEnteredFormat: { numberFormat: { type: "TIME", pattern: "hh:mm:ss" } } }, fields: "userEnteredFormat.numberFormat" } },
        // Hide columns K-L (helper columns for dropdowns)
        { updateDimensionProperties: { range: { sheetId: dashboardSheetId, dimension: "COLUMNS", startIndex: 10, endIndex: 12 }, properties: { hiddenByUser: true }, fields: "hiddenByUser" } },
        // Freeze first row
        { updateSheetProperties: { properties: { sheetId: dashboardSheetId, gridProperties: { frozenRowCount: 1 } }, fields: "gridProperties.frozenRowCount" } },
      ],
    },
  });

  console.log("Dashboard tab created with:");
  console.log("  - Date dropdown filter (auto-populated from data)");
  console.log("  - Agent ID dropdown filter (auto-populated from data)");
  console.log("  - Summary stats (total records, answered, transferred)");
  console.log("  - Filtered activity log table");
  console.log("  - Clear either filter to show all data");

  await pool.end();
}

main().catch((err) => { console.error("Error:", err.message); process.exit(1); });
