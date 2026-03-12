import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import { Pool } from "pg";

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  const r = await pool.query("SELECT workspace_id, sheet_id, token_expiry FROM google_auth");
  console.log("Google auth records:", JSON.stringify(r.rows, null, 2));
  await pool.end();
}
main();
