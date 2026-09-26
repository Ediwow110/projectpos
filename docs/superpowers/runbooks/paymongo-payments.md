# PayMongo payments runbook

This integration uses **PayMongo Hosted Checkout v2** for Card, GCash, and
Maya. NexPOS never accepts raw card numbers or CVC values. The browser is sent
to PayMongo's checkout page, and NexPOS completes the local sale only after a
verified PayMongo webhook confirms payment.

## Required environment variables

Set these only in the deployment secret store:

```text
PAYMONGO_SECRET_KEY=sk_test_...        # test first; use sk_live_... only for go-live
PAYMONGO_WEBHOOK_SECRET=<endpoint secret shown by PayMongo>
PAYMONGO_API_BASE=https://api.paymongo.com
PAYMONGO_WEBHOOK_TOLERANCE_SECONDS=300
WEB_URL=https://app.example.com
```

Do not put PayMongo secrets in `NEXT_PUBLIC_*` variables, browser code, source
control, screenshots, tickets, or chat. Hosted Checkout needs only the server
secret key; NexPOS does not need a PayMongo public key for this flow.

## PayMongo dashboard setup

1. Complete PayMongo merchant activation/KYC.
2. In **Settings → Developers**, start with the test secret key.
3. Ensure Card, GCash, and Maya are enabled for the merchant account.
4. In **Settings → Webhooks**, create an endpoint:

   ```text
   https://<api-domain>/api/v1/payments/paymongo/webhook
   ```

5. Subscribe it to:

   ```text
   checkout_session.payment.paid
   ```

6. Copy the endpoint secret into `PAYMONGO_WEBHOOK_SECRET`.
7. Keep separate webhook endpoints/secrets for test and live mode.

## NexPOS payment lifecycle

1. The cashier creates a normal NexPOS draft sale.
2. Card / GCash / Maya calls
   `POST /api/v1/sales/:id/paymongo/checkout` with an idempotency key.
3. The API verifies stock is currently available, creates one PayMongo Hosted
   Checkout session, and records a local `PENDING` payment.
4. The browser redirects to the returned `checkout_url`.
5. PayMongo redirects the browser back to the sale page after the customer
   finishes or cancels checkout. This browser redirect is **not** proof of
   payment.
6. PayMongo posts `checkout_session.payment.paid` to the webhook endpoint.
7. NexPOS verifies `Paymongo-Signature` against the exact raw request body,
   validates business/sale/session/method/amount, deduplicates the event, then
   atomically:
   - applies the sale inventory movement,
   - marks the local payment `SUCCEEDED`,
   - marks the sale `COMPLETED`,
   - records the billing usage and audit event.

The old direct sale-completion endpoint refuses successful Card / GCash / Maya
recording. Those methods must go through PayMongo. Manual cash, bank transfer,
and other tender flows remain separate.

## Safety behavior

- A returned browser `success_url` never settles a sale by itself.
- Webhook signatures use the raw body, timestamp, HMAC-SHA256, and a timestamp
  tolerance. Bad signatures are rejected before payment state is touched.
- Webhook events are deduplicated through the existing webhook-event ledger.
- Amount, source type, checkout-session ID, business ID, and sale ID must match
  the local pending payment before settlement.
- A repeated checkout request resumes an existing active session instead of
  creating another charge.
- If PayMongo reports the checkout as expired, NexPOS marks that local attempt
  failed before creating a replacement session.
- If a PayMongo payment is already locally `SUCCEEDED`, NexPOS refuses to start
  another checkout for the sale.
- `PAYMENT_UNKNOWN` remains reserved for genuinely uncertain legacy/manual
  provider outcomes and is never silently converted into success.

## Test-mode smoke procedure

1. Deploy or run NexPOS with `sk_test_...` and the **test-mode** webhook
   endpoint secret.
2. Open a register/shift and make sure the product has stock.
3. Create three test sales, one each for Card, GCash, and Maya.
4. Confirm the POS redirects to PayMongo rather than collecting card details.
5. Complete the PayMongo test checkout.
6. Confirm the sale page changes from `PENDING_PAYMENT` to `COMPLETED` after
   webhook delivery.
7. Confirm exactly one `sale` inventory movement exists for the transaction.
8. Redeliver the webhook from the PayMongo dashboard and confirm stock and sale
   usage are not duplicated.
9. Send a PayMongo test webhook with a deliberately invalid amount and confirm
   NexPOS rejects it and leaves the local payment pending.
10. Test a cancelled/abandoned checkout and confirm **Continue secure checkout**
    resumes the same active PayMongo session rather than creating a second one.

## Go-live checklist

- [ ] Test-mode Card, GCash, and Maya flows all pass end to end.
- [ ] Test webhook signature validation passes using PayMongo's real test-event sender.
- [ ] Webhook redelivery is idempotent.
- [ ] `WEB_URL` and the public API domain are HTTPS.
- [ ] Live Card, GCash, and Maya are enabled on the PayMongo account.
- [ ] Replace only `PAYMONGO_SECRET_KEY` and `PAYMONGO_WEBHOOK_SECRET` with the
      live-mode values; do not change application code.
- [ ] Create a separate live-mode webhook endpoint in PayMongo.
- [ ] Run one low-value live transaction per enabled payment method and verify
      the PayMongo dashboard, NexPOS sale, inventory, and receipt all agree.
- [ ] Record the key-rotation and webhook-secret rotation process in the team's
      secret-management procedure.
