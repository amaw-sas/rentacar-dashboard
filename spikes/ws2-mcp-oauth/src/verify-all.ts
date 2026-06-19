// One-command deterministic self-verify: boot the server in-process, then run
// the reference-client asserts against it. Server and client share the same
// in-memory keypair (one process), so SCEN-A4's "valid signature, wrong
// aud/exp" cases truly exercise aud/exp rejection rather than signature.

import { start } from "./server.js";
import { run } from "./reference-client.js";

async function main(): Promise<void> {
  const handle = await start();
  let code = 1;
  try {
    code = await run();
  } finally {
    await handle.close();
  }
  process.exit(code);
}

main().catch((err) => {
  console.error("verify:all failed to run:", err);
  process.exit(1);
});
