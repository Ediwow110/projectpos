import { z } from "zod";

export const moneyMinorSchema = z.number().int("MONEY_NOT_INTEGER").min(0, "MONEY_NEGATIVE");
export const priceSchema = moneyMinorSchema;
export const quantitySchema = z.number().int("QTY_NOT_INTEGER").positive("QTY_NOT_POSITIVE");
export const discountBpsSchema = z.number().int().min(0).max(10000);
