# Dead Men Tell Tales (DMTT)

> **A trove of secret docs have fallen into your hands, and nowhere feels safe.** You need assurance that if anything happens to you, the story still gets out. For Dead Men Tell Tales...

DMTT is a funded monitoring agent for encrypted notes/docs. A journalist, whistleblower, activist, or at-risk researcher encrypts a memo locally, arms the agent with a Ledger-signed Hedera payment, then relies on that prepaid agent to watch the public deadline and publish the release capsule only if check-ins stop.

The agent has money and infrastructure authority, but not the secret. It can create topics, schedules, storage refs, and bounty payments; it cannot read the memo early, fake a human check-in, or quietly erase what happened. It's also pirate themed because why not.

Huge thank you to all of the sponsors and EthGlobal -- you all do an amazing job putting on these events!

## What it does

1. **Encrypts a memo/file locally.** The plaintext never leaves the browser.
2. **Funds the DMTT agent.** The user proves personhood with World ID and signs a Ledger-backed Hedera transfer that prepays the agent for storage, scheduling, monitoring, and the release bounty.
3. **Arms the monitor.** The DMTT agent mirror-verifies the payment, creates the Hedera topic/storage, and creates a scheduled transaction that will post `RELEASE_AUTHORIZED` at the deadline.
4. **Accepts check-ins.** If the user checks in before that scheduled transaction fires, the agent replaces the live trigger: it creates a new scheduled transaction for the next deadline, then cancels the old one.
5. **Releases on silence.** If the deadline passes, Hedera posts `RELEASE_AUTHORIZED`; the monitoring agent publishes the right capsule and pays the bounty.
6. **Cancels if needed.** The user signs a Ledger-backed cancel transfer; the agent mirror-verifies it, deletes the schedule, and shreds the unreleased ladder.

## How partner tech is used

- **Hedera** — the agent's public clock, audit trail, and payment rail.
  - Hedera Schedule Service is the deadline mechanism: arm creates one scheduled transaction for `RELEASE_AUTHORIZED`; each timely check-in replaces it with a new scheduled transaction for the next deadline.
  - Hedera Consensus Service stores ordered switch events (`ARMED`, `CHECKIN_VERIFIED`, `CAPSULE_PUBLISHED`, `CANCELLED`).
  - HFS stores small ciphertexts; HCS chunking handles larger ciphertexts more cheaply.
  - Mirror Node reads verify arm/cancel transfers and reconstruct public state.
  - Payment rails for agent.
- **World ID** — human-only postponement.
  - The first proof enrolls a nullifier into the switch policy.
  - Later proofs must match that human and the exact check-in signal.
  - This deliberately does **not** use delegated World AgentKit: postponement must remain human-only.
- **Ledger** — device-backed authority for high stake signatures.
  - The user signs the arm funding transfer on a Ledger device.
  - The user can only cancel the switch with the Ledger device.

## Rest of the stack

- **Next.js 15 + React 19** for the web app and API routes.
- **TypeScript + pnpm + Node** everywhere. Do not use Bun for this repo.
- **`@hiero-ledger/sdk`** for Hedera operations.
- **Ledger WebHID / Hedera app libraries** for browser-to-device signing.
- **Veo 3.1 animations** for demo/explainer visuals, not for core protocol logic.
- **drand / tlock** — time-lock encryption.
  - The browser creates a ladder of `tlock(K, round)` capsules.
  - Capsules stay private with the agent until Hedera authorizes release.
  - A capsule cannot open before its drand round.

## How AI was used

For this project, I wanted to see how far I could push as a solo hacker using AI tools. I leveraged 3 core tools:

- **Claude Code** was used for extensive back-and-forth planning, architecture review, and implementation work.
- **Codex** was used for code edits, verification passes, README/docs updates, and delegated implementation tasks.
- **Veo 3.1** was used to create demo/explainer visual assets.

Claude and Codex were used together by splitting tasks between agents, reviewing each other's outputs, and iterating on the protocol and UI.


## Architecture at a glance

```text
Browser
  ├─ encrypts memo with AES-256-GCM
  ├─ creates tlock ladder for future deadlines
  ├─ gets World ID proof
  └─ asks Ledger to sign arm/cancel transfers

Next.js API / Funded agent
  ├─ verifies World proofs server-side
  ├─ mirror-verifies Ledger-signed transfers
  ├─ creates Hedera topic, file/storage refs, and schedules
  ├─ stores private unreleased tlock capsules
  └─ spends prepaid HBAR on switch operations

Watcher loop
  ├─ monitors HCS and mirror-node state
  ├─ reacts to RELEASE_AUTHORIZED
  ├─ publishes the authorized capsule
  └─ pays the release bounty from agent funds

Public viewer
  └─ reads the capsule + ciphertext, waits for drand, decrypts in-browser
```

## Hedera submission notes

The README is meant to satisfy the Hedera requirements we found on the ETHGlobal prize page: setup, architecture, and how the funded monitoring agent uses scheduling/payment flows.

DMTT uses native Hedera services directly (no solidity used):

- **Schedule Service** for the unattended deadline trigger the agent monitors.
- **Consensus Service** for the audit log and release/capsule events.
- **File Service / HCS chunking** for encrypted memo storage.
- **Mirror Node REST API** for transaction verification and public state reads.
- **HBAR transfers** for prepaid agent funding, cancel authorization, and release bounty payment.

## Setup

```bash
pnpm install
cp .env.example .env.local
pnpm dev
```

In a second terminal, run the watcher when testing release behavior:

```bash
pnpm watcher
```

Important environment variables:

```text
HEDERA_OPERATOR_ID=
HEDERA_OPERATOR_KEY=
HEDERA_KEY_TYPE=ECDSA_SECP256K1 # testnet faucet accounts are usually ECDSA
WORLD_APP_ID=
WORLD_RP_ID=
WORLD_ACTION=
WORLD_ENV=staging
WORLD_SIGNING_KEY=
ANTHROPIC_API_KEY=
NEXT_PUBLIC_WORLD_APP_ID=
NEXT_PUBLIC_WORLD_ACTION=
NEXT_PUBLIC_WORLD_ENV=staging
```

See `docs/CONTRACTS.md` for the full contract between the UI, API, watcher, and local store.

## Known issues and workarounds

### Ledger cannot approve Hedera allowances

In my original design, I wanted the Ledger account to approve an allowance/budget so the agent could spend only what it needed. However, the Ledger Hedera app cannot sign `AccountAllowanceApprove`, `ConsensusSubmitMessage`, or `ScheduleDelete`. I reached out to HashPack as well, and they confirmed this is not currently possible: ![discord ticket](/references/hashpackSupport.png)

**Workaround:** the user prepays the agent with a Ledger-signed `CryptoTransfer` whose memo is `DMTT:ARM:<policyHash>`. The agent backend verifies the transaction from the Hedera mirror node:

1. transaction result is `SUCCESS`;
2. decoded memo matches the expected arm/cancel memo;
3. the Ledger account has a negative transfer amount, proving that account signed.

Cancel uses the same pattern with a tiny transfer and memo `DMTT:CANCEL:<topicId>`.

### Other Partner-tech issues we hit

- **Hedera SDK naming:** the repo uses `@hiero-ledger/sdk`. Mixing it with older `@hashgraph/sdk` client instances can break integrations.
- **Bun runtime:** `@hiero-ledger/sdk` hit `node:http2` issues under Bun, so the project is Node + pnpm only.
- **World ID environment matching:** When IDKit was set to staging, it still often would try to open a deeplink of the app on chrome browsers. Needed to use URL from qr codes rather than the deeplink.

### Other Notes
- Animated videos with alpha will only work on Chrome browsers.


## Future Developments

- **Improve Trust Model**. While we never give the raw keys to the agent, the timelocked capsules could be read if the agent is not trusted. A future development would be a secure and trusted deletion methedology.

## Repo layout

```text
/app           Next.js page and API routes
/components    Memo, terms, World, Ledger, status, and AI Elements UI
/lib           crypto, Hedera, World, Ledger, store, types, executors
/watcher       release watcher process
/data          local switch JSON store (gitignored)
/docs          feedback and evaluation docs
/spikes        initial tests for idea viability
```

## Ledger docs feedback

The Ledger team was awesome at helping me through implementation issues during the hackathon. The main feedback is not "the device was bad"; the device security model was exactly why I wanted Ledger in this project. The hard parts were around Hedera-specific developer experience, documentation, and local testing.

Main points:

- **Simulator setup should be part of the first tutorial path.** The [Clear Signing wallet guide](https://developers.ledger.com/docs/clear-signing/for-wallets) and the [beginner device connection guide](https://developers.ledger.com/docs/device-interaction/beginner/discover_and_connect) are the exact places where I expected a simulated-device flow. This would be especially useful for agent-assisted development: an agent should be able to verify installation, app configuration, APDU shape, and signing flow without requiring the human to plug in a physical device every time. A second beginner guide for "connect to the simulator, sign a test transaction, then switch to a physical device" would remove a lot of debugging friction.

- **There is no official DMK signer kit for Hedera.** Most DMK examples and signer kits are for chains like Ethereum, Bitcoin, Solana, and Cosmos. For DMTT I had to build a small Hedera bridge myself with Claude Code: WebHID transport through DMK, custom APDU commands for the Hedera app, public-key lookup through the Hedera mirror node, and manual signing of Hedera `TransactionBody` bytes. That was the biggest technical challenge of the hackathon. An official `device-signer-kit-hedera` would make this much easier.

- **The Hedera Ledger app can sign only a subset of Hedera transaction types, but that coverage is not clearly documented.** My first design tried to use allowances so the agent could spend from a constrained budget account. In practice, the Ledger Hedera app could sign `CryptoTransfer`, but not the allowance/schedule/topic transaction types. HashPack also confirmed that this path was not available through their Ledger flow:

  ![HashPack support confirmation about Ledger Hedera limitations](/references/hashpackSupport.png)

- **Because there was no Hedera signer kit, I had to use WebHID directly through DMK, and it was unclear what was officially supported.** The docs say LedgerJS is no longer maintained, but WebHID-related packages still appear active...

  ![LedgerJS maintenance note](/references/ledgerJsMaintained.png)

- **Testnet account setup in Ledger Live needs clearer signposting.** I was trying to set up a Hedera testnet account and did not realize I had to enable developer mode in Ledger Live. A small prompt like "Are you trying to add a testnet account?" with a link to the dev-mode instructions would have saved time.

  ![Ledger Live Hedera account setup reference](/references/ledgerWalletHedera.png)

