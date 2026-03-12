import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { Pool } from "pg";
import fs from "fs";

async function main() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  const sql = fs.readFileSync("src/db/migrations/002-agent-activities.sql", "utf8");

  try {
    await pool.query(sql);
    console.log("Migration applied successfully!");

    const tables = await pool.query(
      "SELECT tablename FROM pg_tables WHERE tablename IN ('agent_activities', 'google_auth')"
    );
    console.log("Tables found:", tables.rows.map((r) => r.tablename).join(", "));

    const indexes = await pool.query(
      "SELECT indexname FROM pg_indexes WHERE tablename = 'agent_activities'"
    );
    console.log("Indexes:", indexes.rows.map((r) => r.indexname).join(", "));
  } catch (err: any) {
    console.error("Migration failed:", err.message);
  } finally {
    await pool.end();
  }
}

main();
