# Cloudflare Access – One-Time PIN

This application expects Cloudflare Access to authenticate the user before requests reach the Worker.

## Application

Create a **Self-hosted** Access application for the final Worker hostname/custom domain.

## Login method

Enable **One-Time PIN**.

Cloudflare sends a single-use code to the approved email address. The PIN is valid for 10 minutes.

## Policy

Recommended for a personal app:

- Action: Allow
- Selector: Emails
- Value: your email address

Alternative for a controlled family/team deployment:

- Action: Allow
- Selector: Emails ending in
- Value: yourdomain.example

## Worker identity

The Worker reads the authenticated email from:

`Cf-Access-Authenticated-User-Email`

The email is normalized to lower case and becomes the stable user key used for D1 settings and push subscriptions.

## Important

Access configuration is account/domain-specific and therefore is intentionally not committed with a real hostname or email address. It must be created in the Cloudflare Zero Trust dashboard (or via the Cloudflare API/Terraform once an account ID and domain are available).
