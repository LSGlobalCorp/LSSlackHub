import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { Pool } from "pg";

async function main() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  try {
    const r = await pool.query("SELECT id, slack_team_id, team_name, is_active FROM workspaces");
    console.log("Workspaces:", JSON.stringify(r.rows, null, 2));
    if (r.rows.length === 0) {
      console.log("\nNo workspaces found. Creating one...");
    }
  } catch (e: any) {
    console.error("Error:", e.message);
  } finally {
    await pool.end();
  }
}

main();
