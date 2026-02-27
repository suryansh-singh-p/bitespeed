import type { Request, Response } from "express";
import type { IdentifyRequestBody, IdentifyResponseBody } from "../types/contact";
import { identifyContact } from "../services/contactService";

export async function identifyController(
  req: Request<unknown, unknown, IdentifyRequestBody>,
  res: Response<IdentifyResponseBody | { error: string }>,
) {
  try {
    const { email, phoneNumber } = req.body ?? {};

    if (email == null && phoneNumber == null) {
      return res.status(400).json({ error: "At least one of email or phoneNumber must be provided." });
    }

    const contact = await identifyContact({ email, phoneNumber });
    return res.status(200).json({ contact });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
}

