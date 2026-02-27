import { Pool } from "pg";
import dotenv from "dotenv";

dotenv.config();

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required");
}

function shouldUseSsl(connectionString: string): boolean {
  if (process.env.DATABASE_SSL != null) {
    return process.env.DATABASE_SSL.toLowerCase() === "true";
  }
  return !/(localhost|127\.0\.0\.1)/i.test(connectionString);
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: shouldUseSsl(process.env.DATABASE_URL)
    ? {
        rejectUnauthorized: false,
      }
    : undefined,
});

