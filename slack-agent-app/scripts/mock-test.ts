import dotenv from "dotenv";
dotenv.config();

import { WebClient } from "@slack/web-api";
import { Pool } from "pg";

const MOCK_PREFIX = "[MOCK-TEST]";

const MOCK_MESSAGES = [
  { text: `${MOCK_PREFIX} Just answered a customer about their refund status in billing`, expected: "answer" },
  { text: `${MOCK_PREFIX} Transferred the VIP client to the retention team`, expected: "transfer" },
  { text: `${MOCK_PREFIX} Escalated ticket #4521 to senior support — needs immediate attention`, expected: "escalation" },
  { text: `${MOCK_PREFIX} Put the caller on hold while checking inventory`, expected: "hold" },
  { text: `${MOCK_PREFIX} Resolved a shipping delay inquiry for order #8834`, expected: "answer" },
  { text: `${MOCK_PREFIX} Handed off the enterprise client to account management`, expected: "transfer" },
  { text: `${MOCK_PREFIX} Customer asked about premium plan pricing, gave them the full comparison`, expected: "answer" },
  { text: `${MOCK_PREFIX} Escalated the network outage to the infrastructure team immediately`, expected: "escalation" },
  { text: `${MOCK_PREFIX} Answered the billing dispute — customer was overcharged by $50`, expected: "answer" },
  { text: `${MOCK_PREFIX} Transferred the Spanish-speaking customer to our bilingual support team`, expected: "transfer" },
  { text: `${MOCK_PREFIX} Put client on hold to verify their account details with the backend`, expected: "hold" },
  { text: `${MOCK_PREFIX} Took care of a returns question about their damaged package`, expected: "answer" },
  { text: `${MOCK_PREFIX} Hey team, lunch is here!`, expected: null },
  { text: `${MOCK_PREFIX} Meeting in 5 minutes everyone`, expected: null },
  { text: `${MOCK_PREFIX} Happy Friday! Anyone want coffee?`, expected: null },
];

async function main() {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) throw new Error("SLACK_BOT_TOKEN not set");

  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) throw new Error("DATABASE_URL not set");

  const slack = new WebClient(token);
  const pool = new Pool({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });

  // Get channels the bot is in
  const channelsResult = await slack.conversations.list({ types: "public_channel", limit: 10 });
  const channels = (channelsResult.channels || []).filter((c) => c.is_member).slice(0, 3);

  if (channels.length === 0) {
    console.error("Bot is not a member of any channels. Add the bot to at least one channel first.");
    process.exit(1);
  }

  console.log(`\nPosting ${MOCK_MESSAGES.length} mock messages across ${channels.length} channels...\n`);

  const expectedActivities = MOCK_MESSAGES.filter((m) => m.expected !== null).length;
  let posted = 0;

  for (let i = 0; i < MOCK_MESSAGES.length; i++) {
    const channel = channels[i % channels.length];
    const msg = MOCK_MESSAGES[i];

    try {
      await slack.chat.postMessage({ channel: channel.id!, text: msg.text });
      posted++;
      console.log(`  [${posted}/${MOCK_MESSAGES.length}] → #${channel.name}: "${msg.text.slice(0, 60)}..." (expect: ${msg.expected || "IGNORE"})`);
    } catch (err) {
      console.error(`  FAILED to post to #${channel.name}:`, err);
    }

    await new Promise((r) => setTimeout(r, 1200));
  }

  console.log(`\nPosted ${posted} messages. Waiting for bot to process (30s)...\n`);
  await new Promise((r) => setTimeout(r, 30000));

  // Verify DB entries
  const dbResult = await pool.query(
    `SELECT action_type, raw_message, confidence FROM agent_activities WHERE raw_message LIKE $1 ORDER BY created_at DESC`,
    [`${MOCK_PREFIX}%`]
  );

  console.log(`\n=== RESULTS ===`);
  console.log(`Expected activities: ${expectedActivities}`);
  console.log(`Found in DB: ${dbResult.rows.length}`);
  console.log(`Match rate: ${((dbResult.rows.length / expectedActivities) * 100).toFixed(1)}%\n`);

  for (const row of dbResult.rows) {
    console.log(`  [${row.action_type}] (conf: ${Number(row.confidence).toFixed(2)}) ${row.raw_message.slice(0, 70)}...`);
  }

  const nonActivityStored = dbResult.rows.filter((r) =>
    MOCK_MESSAGES.some((m) => m.expected === null && r.raw_message === m.text)
  );
  if (nonActivityStored.length > 0) {
    console.log(`\n  WARNING: ${nonActivityStored.length} non-activity messages were incorrectly stored!`);
  } else {
    console.log(`\n  Non-activity filtering: PASS (0 false positives)`);
  }

  // Cleanup
  console.log(`\nCleaning up test data...`);
  const deleted = await pool.query(
    `DELETE FROM agent_activities WHERE raw_message LIKE $1`,
    [`${MOCK_PREFIX}%`]
  );
  console.log(`  Deleted ${deleted.rowCount} test rows from agent_activities.`);

  await pool.end();

  const pass = dbResult.rows.length >= expectedActivities * 0.8;
  console.log(`\n${pass ? "PASS" : "FAIL"}: E2E mock test ${pass ? "completed successfully" : "below 80% threshold"}\n`);
  process.exit(pass ? 0 : 1);
}

main().catch((err) => {
  console.error("Mock test failed:", err);
  process.exit(1);
});
