export function hostedPaymentReturnMessage(value: string | null): string | null {
  if (value === "cancelled") {
    return "Checkout returned as canceled or closed. Payment is still pending in NexPOS; check the provider or settlement status before trying again. This redirect does not confirm that a charge failed.";
  }
  if (value === "success") {
    return "You returned from checkout, but the redirect does not confirm payment. This sale remains pending until NexPOS receives PayMongo's signed confirmation. Do not charge the customer again.";
  }
  return null;
}
