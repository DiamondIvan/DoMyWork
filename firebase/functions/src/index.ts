// Local/dev convenience: load the repo root .env when running in the emulator.
// In production, Firebase Secrets are used instead.
if (
  process.env.FUNCTIONS_EMULATOR === "true" ||
  process.env.FIREBASE_EMULATOR_HUB
) {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  require("dotenv").config({ path: "../../.env" });
}

import { enqueueAutomationRequest } from "./http/enqueueAutomationRequest";
import { exchangeGoogleCode } from "./http/exchangeGoogleCode";
import { onAutomationRequestCreated } from "./triggers/onAutomationRequestCreated";

export {
  enqueueAutomationRequest, exchangeGoogleCode, onAutomationRequestCreated
};

