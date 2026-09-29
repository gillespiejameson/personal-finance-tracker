import { z } from "zod";

export const accountInput = z.object({
  name: z.string().min(1).max(60),
  type: z.enum(["checking", "savings", "credit", "cash", "loan", "investment"]),
  institution: z
    .string()
    .max(60)
    .optional()
    .nullable()
    .transform((v) => (v && v.trim() !== "" ? v.trim() : null)),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .default("#0A84FF"),
  aprBps: z.number().int().min(0).max(10000).nullable().optional(),
  minPaymentCents: z.number().int().min(0).nullable().optional(),
});

export const accountIdSchema = z.number().int().positive();

export type AccountInput = z.input<typeof accountInput>;
export type AccountRecord = z.output<typeof accountInput>;
