import type {
  CheckoutMessage,
  RetrieveSessionResponse,
} from "@mopay/node-sdk";

// The Express server exposes the installed SDK bundle at /sdk for the browser.
// @ts-expect-error TypeScript cannot resolve this runtime-only browser route.
const { MoPayCheckout } = await import("/sdk/index.js") as typeof import("@mopay/node-sdk");

interface CheckoutSessionPayload {
  success: true;
  sessionId: string;
  checkoutUrl?: string;
  checkoutToken?: string;
  reference: string;
  amount: string;
}

interface PaymentFormPayload {
  amount: FormDataEntryValue | null;
  reference: FormDataEntryValue | null;
  customerEmail: FormDataEntryValue | null;
}

const form = queryRequired<HTMLFormElement>("#checkout-form");
const sessionIdInput = queryRequired<HTMLInputElement>("#sessionId");
const checkStatusButton = queryRequired<HTMLButtonElement>("#check-status");
const statusOutput = queryRequired<HTMLOutputElement>("#status");
const payButton = queryRequired<HTMLButtonElement>("#pay-now");
const transactionDetails = queryRequired<HTMLElement>("#transaction-details");
const transactionSummary = queryRequired<HTMLDListElement>("#transaction-summary");
const transactionJson = queryRequired<HTMLPreElement>("#transaction-json");

let verificationSessionId: string | undefined;
let verificationStarted = false;

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  await startCheckout();
});

payButton.addEventListener("click", async () => {
  await startCheckout();
});

checkStatusButton.addEventListener("click", async () => {
  await checkTransaction(sessionIdInput.value.trim());
});

async function startCheckout(): Promise<void> {
  setBusy(true);
  verificationSessionId = undefined;
  verificationStarted = false;
  setStatus("Creating checkout session on merchant backend...");

  try {
    const session = await createCheckoutSession(readPaymentForm());
    sessionIdInput.value = session.sessionId;
    setStatus(`Session created: ${session.sessionId}`);

    const handle = MoPayCheckout.open({
      checkoutUrl: session.checkoutUrl,
      checkoutToken: session.checkoutToken,
      allowedOrigins: [window.location.origin],
      width: 571.4,
      height: 418.4,
      resizable: false,
      closeOnRedirect: true,
      onOpen: () => setStatus(`Checkout opened for ${session.reference}`),
      onMessage: (message: CheckoutMessage) => {
        console.log("MoPay checkout message", message);
        verificationSessionId = message.sessionId || session.sessionId;

        if (message.type === "mopay.checkout.redirect") {
          setStatus("Checkout returned to merchant bridge. Closing dialog...");
        }
      },
      onSuccess: (message: CheckoutMessage) => {
        verificationSessionId = message.sessionId || session.sessionId;
        setStatus(`Payment success callback received for ${message.sessionId || session.sessionId}`);
      },
      onFailed: (message: CheckoutMessage) => {
        verificationSessionId = message.sessionId || session.sessionId;
        setStatus(`Payment failed: ${message.error || message.sessionId || session.sessionId}`);
      },
      onCancel: (message: CheckoutMessage) => {
        verificationSessionId = message.sessionId || session.sessionId;
        setStatus("Payment cancelled");
      },
      onClose: async () => {
        setStatus("Checkout closed. Verifying transaction on merchant backend...");
        await verifyCheckoutResult(verificationSessionId || session.sessionId);
        setBusy(false);
      },
    });
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "Checkout failed");
    setBusy(false);
  }
}

async function verifyCheckoutResult(sessionId: string): Promise<void> {
  if (verificationStarted) {
    return;
  }

  verificationStarted = true;
  await checkTransaction(sessionId);
}

async function createCheckoutSession(order: PaymentFormPayload): Promise<CheckoutSessionPayload> {
  const response = await fetch("/api/create-mopay-checkout", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(order),
  });

  return readApiResponse<CheckoutSessionPayload>(response);
}

async function checkTransaction(sessionId: string): Promise<void> {
  if (!sessionId) {
    setStatus("Enter a session ID");
    return;
  }

  try {
    const transaction = await verifyTransaction(sessionId);
    const result = transaction.session.status === "COMPLETED"
      ? "successful"
      : transaction.session.status.toLowerCase();

    renderTransaction(transaction);
    setStatus(`Verified transaction ${result}: ${transaction.session.sessionId}`);
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "Could not retrieve transaction");
  }
}

async function verifyTransaction(sessionId: string): Promise<RetrieveSessionResponse> {
  const response = await fetch(`/api/mopay-session/${encodeURIComponent(sessionId)}`);
  return readApiResponse<RetrieveSessionResponse>(response);
}

function readPaymentForm(): PaymentFormPayload {
  const formData = new FormData(form);

  return {
    amount: formData.get("amount"),
    reference: formData.get("reference"),
    customerEmail: formData.get("customerEmail"),
  };
}

async function readApiResponse<T>(response: Response): Promise<T> {
  const data = await response.json().catch(() => ({})) as {
    success?: boolean;
    error?: string;
    message?: string;
  };

  if (!response.ok || data.success === false) {
    throw new Error(data.error || data.message || `Request failed with ${response.status}`);
  }

  return data as T;
}

function setBusy(isBusy: boolean): void {
  payButton.disabled = isBusy;
  checkStatusButton.disabled = isBusy;
}

function setStatus(message: string): void {
  statusOutput.value = message;
}

function renderTransaction(transaction: RetrieveSessionResponse): void {
  const session = transaction.session;
  const rows: Array<[string, unknown]> = [
    ["Session ID", session.sessionId],
    ["Reference", session.reference],
    ["Amount", session.amount],
    ["Session status", session.status],
    ["Transaction status", session.transactionStatus],
    ["Transaction ID", session.transactionId],
    ["Payment method", session.selectedPaymentMethod ?? session.paymentMethod],
    ["Created", session.createdAt],
    ["Completed", session.completedAt],
  ];

  transactionSummary.replaceChildren(
    ...rows
      .filter(([, value]) => value !== undefined && value !== null && value !== "")
      .flatMap(([label, value]) => {
        const term = document.createElement("dt");
        const description = document.createElement("dd");
        term.textContent = label;
        description.textContent = String(value);
        return [term, description];
      }),
  );

  transactionJson.textContent = JSON.stringify(transaction, null, 2);
  transactionDetails.hidden = false;
}

function queryRequired<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) {
    throw new Error(`Missing required element: ${selector}`);
  }

  return element;
}
