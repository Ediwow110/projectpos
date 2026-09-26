# Transactional email deployment runbook

## Purpose

NexPOS uses transactional email for password resets and optional email verification. The implementation is provider-agnostic SMTP through Nodemailer; no provider-specific SDK is required.

## Required production environment

Set all of the following before starting the production API:

```text
WEB_URL=https://pos.example.com
SMTP_HOST=smtp.provider.example
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=provider-user
SMTP_PASS=provider-secret
EMAIL_FROM=NexPOS <noreply@example.com>
```

`SMTP_USER` and `SMTP_PASS` must either both be present or both be absent (for an authenticated vs trusted relay). `SMTP_SECURE=true` is normally used for implicit TLS such as port 465; `false` allows the normal STARTTLS path. Production requires an HTTPS `WEB_URL` because reset and verification links point there.

If production mail configuration is absent or malformed, API startup fails with `ENV_MISSING_EMAIL_CONFIG` or `ENV_INVALID_EMAIL_CONFIG` instead of silently running with broken account recovery.

## Provider/domain setup

Create a transactional sender/domain with the selected provider and publish the DNS records the provider requires. At minimum, verify SPF and DKIM; publish an appropriate DMARC policy once alignment is confirmed. Use a dedicated transactional sender such as `noreply@...` and keep SMTP credentials in the deployment secret store, never in the repository.

## Smoke procedure

1. Start the API with production-like PostgreSQL and SMTP settings.
2. Register a new account with `AUTH_REQUIRE_EMAIL_VERIFICATION=1`.
3. Confirm the API response contains `verificationRequired: true` and no verification token.
4. Confirm the verification email arrives and its link points to `WEB_URL/verify-email?token=...`.
5. Open the link and confirm the page reports successful verification; the registration session should then be allowed through the normal session guard.
6. Request password reset for that account. Confirm the public response remains generic and contains no credential.
7. Confirm the reset email arrives and its link points to `WEB_URL/password-reset?token=...`.
8. Open the link, set a new password, and confirm the old sessions are revoked and the new credential can sign in.

## Security and failure behavior

- Password-reset tokens expire after one hour and are single-use.
- Email-verification tokens expire after 24 hours.
- Public reset/resend routes do not reveal whether an account exists.
- Tokens are stored hashed and are not written to the HTTP response or audit log.
- User-controlled display names are HTML-escaped in templates.
- SMTP delivery errors do not disclose account existence; failures write `auth.password-reset.delivery-failed` or `auth.email-verification.delivery-failed` audit actions for operations review.
- Repeated reset/verification requests are rate-limited.

## Operational checks

Investigate delivery-failed audit events, provider bounce/complaint dashboards, and SMTP authentication errors. If links are generated with the wrong host, fix `WEB_URL`; do not rewrite tokens manually. If a sender credential is exposed, rotate it at the provider and update the deployment secret immediately.
