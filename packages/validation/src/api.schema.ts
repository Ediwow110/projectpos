import { z } from "zod";

export const errorEnvelopeSchema = z.object({
  code: z.string(),
  message: z.string(),
  correlationId: z.string(),
  fields: z.record(z.array(z.string())).optional(),
});

export const pagePaginationSchema = z.object({
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1).max(100),
});

export const cursorPaginationSchema = z.object({
  cursor: z.string().optional(),
  limit: z.number().int().min(1).max(100),
});
