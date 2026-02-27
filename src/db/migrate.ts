import { pool } from "./pool";

const MIGRATION_SQL = `
CREATE TABLE IF NOT EXISTS contacts (
  id SERIAL PRIMARY KEY,
  phone_number TEXT NULL,
  email TEXT NULL,
  linked_id INT NULL,
  link_precedence TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ NULL
);

CREATE INDEX IF NOT EXISTS idx_contacts_email ON contacts (email);
CREATE INDEX IF NOT EXISTS idx_contacts_phone_number ON contacts (phone_number);
CREATE INDEX IF NOT EXISTS idx_contacts_linked_id ON contacts (linked_id);

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_contacts_set_updated_at ON contacts;
CREATE TRIGGER trg_contacts_set_updated_at
BEFORE UPDATE ON contacts
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();
`;

async function main() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(MIGRATION_SQL);
    await client.query("COMMIT");
    // eslint-disable-next-line no-console
    console.log("Migration completed.");
  } catch (err) {
    await client.query("ROLLBACK");
    // eslint-disable-next-line no-console
    console.error("Migration failed:", err);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

void main();

