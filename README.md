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

## Possible use cases

- **Journalist or whistleblower safety.** A source can encrypt evidence and set a public release condition that does not depend on one company, server, or friend honoring a private promise.
- **Emergency disclosure for researchers, activists, or lawyers.** A sensitive memo can stay sealed while the author is active, then become decryptable if check-ins stop.
- **Accountability for high-stakes instructions.** A user can pre-commit a signed policy, public audit trail, and release process before entering a risky situation.
- **Incentive structures and commitment contracts.** The same check-in pattern can be adapted so silence authorizes an action the user wants to avoid. For example, a gym accountability product could require periodic check-ins and charge an extra fee, donate to a disliked cause, or notify an accountability partner if the user misses a check-in. The current MVP releases encrypted information; payment or penalty actions would be a natural extension using a pre-funded escrow or external payment integration.

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

## Market validation and feedback

This is still a hackathon MVP, so the honest market status is early validation, not traction. What is validated so far is the technical and developer-risk side: live Hedera testnet spikes proved the schedule clock, HFS/HCS storage, mirror verification, and tlock release path; HashPack confirmed the Ledger allowance route was not available; and Ledger feedback shaped the custom DMK-based Hedera signing path.

Informal anonymous demo feedback on the pirate theme has been positive:

- "The pirate framing makes a scary security product approachable and hilarious."
- "I remembered the product because of the captain. Captain John Lockbeard is my guy."
- "Will use for my wifi passwords."

The next feedback loop is deliberately narrow:

- **Digital-safety users:** interview journalists, researchers, and activists on whether a public release condition is useful or too dangerous without a trusted support org.
- **Legal and compliance reviewers:** test whether the release/cancel semantics are explainable enough for lawyers, estate planners, or whistleblower support teams.
- **Commitment-contract users:** pilot a lower-risk version, such as gym or study check-ins, where a missed check-in triggers a fee, donation, or notification instead of publishing sensitive material.
- **Hedera builders:** validate whether the schedule-as-clock and mirror-verified transfer pattern is reusable for other agentic workflows.

## Business model and go-to-market

The first commercial wedge is a hosted funded-monitoring service: users prepay the agent at arm time, and the service charges a small platform fee on top of Hedera network costs. Institutional customers, such as investigative nonprofits, legal clinics, or high-risk research teams, could pay for managed setup, rehearsal switches, and operational support.

The broader go-to-market path is to start with safer commitment-contract use cases, prove the check-in UX and reliability, then move into higher-stakes disclosure workflows with partners who already support at-risk users. Future revenue could come from per-switch fees, organization subscriptions, optional per-check-in service fees, and a courier/watchtower network that pays independent operators to verify releases.

## Hedera network impact

Every switch creates real Hedera activity; Hedera is not just a lookup layer.

- **Small memo arm:** about 5 transactions: Ledger funding `CryptoTransfer`, immutable HFS `FileCreate`, audit `TopicCreate`, `ARMED` `TopicMessageSubmit`, and `ScheduleCreate`.
- **Large memo arm:** the small-memo path plus a dedicated HCS storage topic and one `TopicMessageSubmit` per ciphertext chunk.
- **Each check-in:** about 3+ transactions: new `ScheduleCreate`, old `ScheduleDelete`, and one or more HCS messages for `CHECKIN_VERIFIED`.
- **Release:** about 4 transactions: scheduled `RELEASE_AUTHORIZED`, `CAPSULE_PUBLISHED`, release-bounty `CryptoTransfer`, and `BULLETIN`.
- **Cancel:** about 3 transactions: Ledger cancel `CryptoTransfer`, `ScheduleDelete`, and `CANCELLED`.

At usage scale, DMTT would drive recurring HCS traffic, schedule creation/deletion, mirror reads, and HBAR transfers. It also gives Hedera exposure to non-DeFi users: journalists, NGOs, legal teams, safety researchers, and accountability-product builders.

## Demo checklist

1. Open the app and write a short memo. Show that plaintext stays in the browser.
2. Choose terms, prove personhood with World ID, and sign the arm funding transfer on Ledger.
3. Show the new Hedera topic on HashScan with `ARMED` and the active scheduled release.
4. Run `pnpm watcher` and perform a check-in. Confirm the deadline advances and the old schedule is deleted.
5. Let a short demo deadline pass. Show Hedera posting `RELEASE_AUTHORIZED`, then the watcher publishing `CAPSULE_PUBLISHED`, paying the bounty, and posting `BULLETIN`.
6. Open the public switch page and reveal the memo in-browser after the tlock round has passed.
7. On a second switch, sign `DMTT:CANCEL:<topicId>` on Ledger and show `CANCELLED`.

## Hedera submission notes

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
