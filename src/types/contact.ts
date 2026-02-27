export type LinkPrecedence = "primary" | "secondary";

export interface IdentifyRequestBody {
  email?: string;
  phoneNumber?: string;
}

export interface ConsolidatedContact {
  primaryContactId: number;
  emails: string[];
  phoneNumbers: string[];
  secondaryContactIds: number[];
}

export interface IdentifyResponseBody {
  contact: ConsolidatedContact;
}

export interface ContactRow {
  id: number;
  phone_number: string | null;
  email: string | null;
  linked_id: number | null;
  link_precedence: LinkPrecedence;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}

