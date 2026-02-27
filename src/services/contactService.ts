import type { PoolClient } from "pg";
import { pool } from "../db/pool";
import type { ConsolidatedContact, ContactRow, LinkPrecedence } from "../types/contact";

function getPrimaryId(row: ContactRow): number {
  if (row.link_precedence === "primary") return row.id;
  return row.linked_id ?? row.id;
}

function asEmptyStringIfNull(value: string | null): string {
  return value ?? "";
}

function uniqueInOrder(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    if (seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}

async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function findContactsByEmailOrPhone(client: PoolClient, email?: string, phoneNumber?: string): Promise<ContactRow[]> {
  if (email == null && phoneNumber == null) return [];

  if (email != null && phoneNumber != null) {
    const res = await client.query<ContactRow>(
      `
      SELECT *
      FROM contacts
      WHERE deleted_at IS NULL
        AND (email = $1 OR phone_number = $2)
      `,
      [email, phoneNumber],
    );
    return res.rows;
  }

  if (email != null) {
    const res = await client.query<ContactRow>(
      `
      SELECT *
      FROM contacts
      WHERE deleted_at IS NULL
        AND email = $1
      `,
      [email],
    );
    return res.rows;
  }

  const res = await client.query<ContactRow>(
    `
    SELECT *
    FROM contacts
    WHERE deleted_at IS NULL
      AND phone_number = $1
    `,
    [phoneNumber],
  );
  return res.rows;
}

async function insertContact(
  client: PoolClient,
  args: {
    email?: string;
    phoneNumber?: string;
    linkedId: number | null;
    linkPrecedence: LinkPrecedence;
  },
): Promise<ContactRow> {
  const res = await client.query<ContactRow>(
    `
    INSERT INTO contacts (email, phone_number, linked_id, link_precedence)
    VALUES ($1, $2, $3, $4)
    RETURNING *
    `,
    [args.email ?? null, args.phoneNumber ?? null, args.linkedId, args.linkPrecedence],
  );
  return res.rows[0]!;
}

async function fetchCluster(client: PoolClient, primaryId: number): Promise<ContactRow[]> {
  const res = await client.query<ContactRow>(
    `
    SELECT *
    FROM contacts
    WHERE deleted_at IS NULL
      AND (id = $1 OR linked_id = $1)
    ORDER BY created_at ASC
    `,
    [primaryId],
  );
  return res.rows;
}

function buildConsolidatedResponse(primaryId: number, clusterRows: ContactRow[]): ConsolidatedContact {
  const primary = clusterRows.find((c) => c.id === primaryId) ?? clusterRows.find((c) => c.link_precedence === "primary");
  const primaryEmail = asEmptyStringIfNull(primary?.email ?? null);
  const primaryPhone = asEmptyStringIfNull(primary?.phone_number ?? null);

  const secondaries = clusterRows
    .filter((c) => c.id !== primaryId)
    .filter((c) => c.linked_id === primaryId || c.link_precedence === "secondary")
    .sort((a, b) => a.created_at.getTime() - b.created_at.getTime());

  const emails = uniqueInOrder([primaryEmail, ...secondaries.map((c) => asEmptyStringIfNull(c.email))]);
  const phoneNumbers = uniqueInOrder([primaryPhone, ...secondaries.map((c) => asEmptyStringIfNull(c.phone_number))]);
  const secondaryContactIds = secondaries.map((c) => c.id);

  return {
    primaryContactId: primaryId,
    emails,
    phoneNumbers,
    secondaryContactIds,
  };
}

async function fetchPrimariesByIds(client: PoolClient, primaryIds: number[]): Promise<ContactRow[]> {
  if (primaryIds.length === 0) return [];
  const res = await client.query<ContactRow>(
    `
    SELECT *
    FROM contacts
    WHERE deleted_at IS NULL
      AND id = ANY($1::int[])
    `,
    [primaryIds],
  );
  return res.rows;
}

async function mergeClustersToOldestPrimary(client: PoolClient, primaryIds: number[]): Promise<number> {
  const unique = Array.from(new Set(primaryIds));
  if (unique.length <= 1) return unique[0]!;

  const primaries = await fetchPrimariesByIds(client, unique);
  if (primaries.length === 0) return unique[0]!;

  primaries.sort((a, b) => {
    const t = a.created_at.getTime() - b.created_at.getTime();
    return t !== 0 ? t : a.id - b.id;
  });

  const keep = primaries[0]!;
  const keepId = keep.id;
  const demoteIds = primaries.slice(1).map((p) => p.id);

  for (const demoteId of demoteIds) {
    await client.query(
      `
      UPDATE contacts
      SET link_precedence = 'secondary',
          linked_id = $1,
          updated_at = NOW()
      WHERE deleted_at IS NULL
        AND id = $2
      `,
      [keepId, demoteId],
    );

    await client.query(
      `
      UPDATE contacts
      SET linked_id = $1,
          updated_at = NOW()
      WHERE deleted_at IS NULL
        AND linked_id = $2
      `,
      [keepId, demoteId],
    );
  }

  return keepId;
}

export async function identifyContact(input: { email?: string; phoneNumber?: string }): Promise<ConsolidatedContact> {
  const { email, phoneNumber } = input;

  return withTransaction(async (client) => {
    const matches = await findContactsByEmailOrPhone(client, email, phoneNumber);

    // CASE 1 — No match found
    if (matches.length === 0) {
      const created = await insertContact(client, {
        email,
        phoneNumber,
        linkedId: null,
        linkPrecedence: "primary",
      });
      const cluster = await fetchCluster(client, created.id);
      return buildConsolidatedResponse(created.id, cluster);
    }

    const matchedPrimaryIds = matches.map(getPrimaryId);
    const uniquePrimaryIds = Array.from(new Set(matchedPrimaryIds));

    // CASE 4 — Two (or more) separate clusters get linked
    let primaryId = uniquePrimaryIds[0]!;
    if (uniquePrimaryIds.length > 1) {
      primaryId = await mergeClustersToOldestPrimary(client, uniquePrimaryIds);
    }

    // CASE 3 — Match found, new information (only meaningful if both fields provided)
    if (email != null && phoneNumber != null) {
      const emailExists = matches.some((c) => c.email === email);
      const phoneExists = matches.some((c) => c.phone_number === phoneNumber);

      // CASE 2 — Match found, no new information
      if (!(emailExists && phoneExists)) {
        await insertContact(client, {
          email,
          phoneNumber,
          linkedId: primaryId,
          linkPrecedence: "secondary",
        });
      }
    }

    const cluster = await fetchCluster(client, primaryId);
    return buildConsolidatedResponse(primaryId, cluster);
  });
}

