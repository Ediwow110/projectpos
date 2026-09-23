import { z } from "zod";

export const deviceEnrollSchema = z.object({
  label: z.string().trim().min(1, "VALIDATION").max(80, "VALIDATION"),
});

export const syncCheckKeySchema = z.object({
  key: z.string().min(1, "VALIDATION").max(128, "VALIDATION"),
  commandType: z.string().min(1, "VALIDATION").max(64, "VALIDATION"),
});

export const syncCheckSchema = z.object({
  keys: syncCheckKeySchema.array().min(1, "VALIDATION").max(100, "VALIDATION"),
});

export const syncResolveSchema = z.object({
  key: z.string().min(1, "VALIDATION").max(128, "VALIDATION"),
  commandType: z.string().min(1, "VALIDATION").max(64, "VALIDATION"),
  reason: z.string().trim().min(3, "VALIDATION").max(500, "VALIDATION"),
});
