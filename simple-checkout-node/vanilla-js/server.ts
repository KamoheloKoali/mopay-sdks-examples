import dotenv from "dotenv";
import express, { type Request, type Response } from "express";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  MoPay,
  MoPayAPIError,
  type PaymentFrequency,
} from "@mopay/node-sdk";

interface CheckoutRequestBody {
  amount?: string | number;
  reference?: string;
  description?: string;
  customerEmail?: string;
  customerName?: string;
  paymentFrequency?: string;
  productName?: string;
  productDetails?: string;
  productImage?: string;
  payWhatYouWant?: boolean;
  minimumAmount?: string | number;
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, "..");

dotenv.config({ path: join(projectRoot, ".env") });
dotenv.config();

const app = express();
const port = Number(process.env.PORT || 4173);
const host = process.env.HOST || "127.0.0.1";

let mopay: MoPay | undefined;

app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use("/sdk", express.static(join(projectRoot, "node_modules/@mopay/node-sdk/dist")));
app.use(express.static(__dirname));
app.use(express.static(projectRoot));

app.post("/api/create-mopay-checkout", async (request: Request, response: Response) => {
  const body = request.body as CheckoutRequestBody;

  console.log("Creating MoPay checkout session", {
    amount: body.amount,
    reference: body.reference,
    customerEmail: body.customerEmail,
  });

  try {
    const session = await getMoPayClient().createPaymentSession({
      amount: body.amount ?? "",
      reference: body.reference ?? "",
      redirectUrl: getRedirectUrl(request),
      description: optionalString(body.description),
      customerEmail: optionalString(body.customerEmail),
      customerName: optionalString(body.customerName),
      paymentFrequency: optionalPaymentFrequency(body.paymentFrequency),
      productName: optionalString(body.productName),
      productDetails: optionalString(body.productDetails),
      productImage: optionalString(body.productImage),
      payWhatYouWant: optionalBoolean(body.payWhatYouWant),
      minimumAmount: body.minimumAmount,
    });

    response.json({
      success: true,
      sessionId: session.sessionId,
      checkoutUrl: session.paymentUrl || session.checkoutUrl || session.checkout_url,
      checkoutToken: session.checkoutToken || session.checkout_token,
      reference: session.reference,
      amount: session.amount,
    });
  } catch (error) {
    sendApiError(response, error);
  }
});

app.get("/api/mopay-session/:sessionId", async (request: Request, response: Response) => {
  const sessionId = routeParam(request.params.sessionId);

  console.log("Retrieving MoPay session", sessionId);

  try {
    const transaction = await getMoPayClient().getTransaction(sessionId);
    response.json(transaction);
  } catch (error) {
    sendApiError(response, error);
  }
});

app.get("/api/mopay-session/:sessionId/success", async (request: Request, response: Response) => {
  const sessionId = routeParam(request.params.sessionId);

  console.log("Checking MoPay session success", sessionId);

  try {
    const transaction = await getMoPayClient().getTransaction(sessionId);
    response.json({
      success: true,
      paid: getMoPayClient().isSuccessful(transaction),
      session: transaction.session,
    });
  } catch (error) {
    sendApiError(response, error);
  }
});

app.options("/payment-complete", (_request: Request, response: Response) => {
  setCompletionCorsHeaders(response);
  response.sendStatus(204);
});

app.all("/payment-complete", (request: Request, response: Response) => {
  setCompletionCorsHeaders(response);

  if (request.method !== "GET" && request.method !== "HEAD") {
    const params = mergeRedirectParams(request);
    response.redirect(303, `/payment-complete?${params.toString()}`);
    return;
  }

  response.sendFile(join(projectRoot, "payment-complete.html"));
});

const server = app.listen(port, host);

server.on("listening", () => {
  console.log(`MoPay checkout example running at http://${host}:${port}`);
  console.log("Set MOPAY_API_KEY in .env before creating a real checkout session.");
});

server.on("error", (error) => {
  console.error(error);
  process.exitCode = 1;
});

function getMoPayClient(): MoPay {
  if (mopay) {
    return mopay;
  }

  if (!process.env.MOPAY_API_KEY) {
    throw new Error("Set MOPAY_API_KEY in your environment before creating MoPay sessions.");
  }

  mopay = new MoPay({
    apiKey: process.env.MOPAY_API_KEY,
    baseUrl: process.env.MOPAY_BASE_URL || "https://mopay.co.ls",
  });

  return mopay;
}

function getRedirectUrl(request: Request): string {
  if (process.env.MOPAY_REDIRECT_URL) {
    return process.env.MOPAY_REDIRECT_URL;
  }

  const publicUrl = process.env.MERCHANT_PUBLIC_URL || `${request.protocol}://${request.get("host")}`;
  return new URL("/payment-complete", publicUrl).href;
}

function optionalString(value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  return String(value);
}

function optionalPaymentFrequency(value: unknown): PaymentFrequency | undefined {
  const parsed = optionalString(value);
  if (!parsed) {
    return undefined;
  }

  return parsed as PaymentFrequency;
}

function optionalBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function routeParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function setCompletionCorsHeaders(response: Response): void {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Methods", "GET,HEAD,POST,OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
  response.setHeader("Access-Control-Max-Age", "600");
  response.setHeader("Access-Control-Allow-Private-Network", "true");
  response.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
}

function mergeRedirectParams(request: Request): URLSearchParams {
  const params = new URLSearchParams();

  addParams(params, request.query);

  if (isRecord(request.body)) {
    addParams(params, request.body);
  }

  return params;
}

function addParams(params: URLSearchParams, source: Record<string, unknown>): void {
  Object.entries(source).forEach(([key, value]) => {
    if (value === undefined || value === null) {
      return;
    }

    if (Array.isArray(value)) {
      value.forEach((entry) => params.append(key, String(entry)));
      return;
    }

    params.set(key, String(value));
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sendApiError(response: Response, error: unknown): void {
  if (error instanceof MoPayAPIError) {
    response.status(error.statusCode || 400).json({
      success: false,
      error: error.message,
      code: error.code,
      details: error.response,
    });
    return;
  }

  response.status(500).json({
    success: false,
    error: error instanceof Error ? error.message : "Checkout request failed",
  });
}
