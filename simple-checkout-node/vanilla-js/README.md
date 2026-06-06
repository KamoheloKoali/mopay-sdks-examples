# MoPay Simple Checkout Node Example

This example shows a merchant-owned Express backend creating a MoPay checkout session with `@mopay/node-sdk`, a browser page opening the hosted checkout in the SDK dialog, and a merchant completion page closing the dialog after MoPay redirects back.

## Run

```sh
pnpm install
pnpm dev
```

Open:

```txt
http://127.0.0.1:4173
```

Set your MoPay credentials in `.env`:

```env
MOPAY_API_KEY=your_api_key
MOPAY_BASE_URL=https://preview.mopay.co.ls
MERCHANT_PUBLIC_URL=https://your-public-dev-url.example
MOPAY_REDIRECT_URL=https://your-public-dev-url.example/payment-complete
```

## Localhost And Private Network Redirects

Hosted checkout pages run on a public MoPay origin. If the checkout or 3DS flow redirects from that public origin back to a private-network URL such as:

```txt
http://localhost:4173/payment-complete
http://127.0.0.1:4173/payment-complete
http://192.168.x.x/payment-complete
```

modern browsers may block the request inside an iframe. In Chrome or Brave this can appear as:

```txt
Cross-Origin Resource Sharing error: LocalNetworkAccessPermissionDenied
Origin: null
```

This is browser security, not an SDK failure. A public site inside an iframe is not always allowed to navigate or request a private local address.

For local development, expose the example through a public HTTPS tunnel:

```sh
ngrok http 4173
```

or:

```sh
cloudflared tunnel --url http://localhost:4173
```

Then set:

```env
MERCHANT_PUBLIC_URL=https://your-tunnel-url.ngrok-free.app
MOPAY_REDIRECT_URL=https://your-tunnel-url.ngrok-free.app/payment-complete
```

Restart `pnpm dev` after editing `.env`. If MoPay enforces allowed origins for iframe checkout, add the tunnel origin to the merchant's allowed origins as well.

In production, use your real public HTTPS merchant domain.

## SDK Methods Used

### `new MoPay({ apiKey, baseUrl })`

Used in `server.ts` only. This is the secret-key server SDK client. The API key must never be sent to browser code.

### `mopay.createPaymentSession(params)`

Used by `POST /api/create-mopay-checkout` to create a hosted MoPay checkout session. The frontend only receives the returned `checkoutUrl`, `checkoutToken`, and `sessionId`.

### `MoPayCheckout.open(options)`

Used in `app.ts` to open the MoPay-hosted checkout page in an iframe dialog.

Important options in this example:

- `checkoutUrl`: the hosted MoPay payment URL returned by the backend.
- `checkoutToken`: fallback if the API returns a token instead of a URL.
- `allowedOrigins`: allows trusted messages from the merchant completion page.
- `closeOnRedirect`: closes the dialog when the merchant completion page sends a redirect message.
- `redirectAfterClose`: redirects the main merchant page after the dialog closes.
- `onSuccess`, `onFailed`, `onCancel`: UI feedback only.
- `onClose`: verifies the transaction after the checkout closes.

### `MoPayCheckout.completeRedirect(options)`

Used in `payment-complete.html`, the merchant-owned redirect bridge page. Once MoPay redirects the iframe or popup to `/payment-complete`, this helper reads the redirect query parameters and posts a trusted message back to the opener/parent.

That message lets the SDK:

- close the iframe dialog or popup,
- call the relevant UI callback,
- optionally redirect the main merchant page using `redirectTo`.

The SDK cannot inspect or intercept cross-origin MoPay, 3DS, or bank pages before they reach your merchant `redirectUrl`. The bridge page is what makes auto-close possible safely.

### `mopay.getTransaction(sessionId)`

Used by `GET /api/mopay-session/:sessionId` to retrieve current transaction/session data from MoPay.

### `mopay.isSuccessful(transaction)`

Used by `GET /api/mopay-session/:sessionId/success` to convert the retrieved transaction into a boolean paid/not-paid result.

Frontend callbacks are not proof of payment. Always verify using `mopay.getTransaction(sessionId)` or signed webhooks before delivering value.

## Redirect Route Behavior

The example supports both common redirect shapes:

- `GET /payment-complete?status=success&sessionId=...`
- `POST /payment-complete` with `application/x-www-form-urlencoded`

`server.ts` parses form-encoded POST bodies, merges them with query params, then redirects to the GET completion URL so `payment-complete.html` can read everything from `window.location.search`.
