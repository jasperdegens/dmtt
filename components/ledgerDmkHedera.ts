// components/ledgerDmkHedera.ts — Ledger ⇄ Hedera over the Device Management Kit (DMK).
//
// WHY THIS EXISTS (and why it isn't a signer kit): the DMK ships signer kits for
// Ethereum/Bitcoin/Solana/Cosmos/… but NOT Hedera.
// So we drive the on-device Hedera app ourselves through DMK's generic command layer:
// DMK owns transport / session / app-open / error-classification (everything a signer
// kit would give us), and the two Hedera-specific operations — get-public-key and
// sign-transaction — are implemented here as custom APDU `Command`s.
//
// THE APDU PROTOCOL IS PINNED TO THE FIRMWARE, NOT to @ledgerhq/hw-app-hedera.
// The published `hw-app-hedera` getPublicKey serializes a full BIP-32 path, but the
// current `app-hedera` firmware (LedgerHQ/app-hedera) reads a 4-byte LITTLE-ENDIAN key
// index and builds the fixed path m/44'/3030'/0'/0'/index' itself. Sending a serialized
// path makes the device derive the WRONG key (the path's leading bytes are misread as a
// huge index) — which is exactly the "can't identify the account" failure. Verified in
// src/get_public_key.c (`U4LE(buffer, 0)`), src/sign_transaction.c (`U4LE(buffer, 0)` +
// raw TransactionBody) and src/hedera.c (Ed25519/SLIP-10, `hedera_set_path`).
//
//   getPublicKey : CLA e0  INS 02  P1 00=show|01=silent  P2 00   data = u32LE(index)
//                  → 32-byte raw Ed25519 public key
//   signTx       : CLA e0  INS 04  P1 00  P2 00   data = u32LE(index) ‖ TransactionBody
//                  → 64-byte Ed25519 signature over the body bytes (signed verbatim)
//
// This module is browser-only (WebHID) and holds NO secrets: the device key never
// leaves the Ledger. It is imported only by the (client) LedgerSignCard.

import {
	ApduBuilder,
	ApduParser,
	type ApduResponse,
	type Command,
	type CommandResult,
	CommandResultFactory,
	CommandUtils,
	type DeviceManagementKit,
	DeviceManagementKitBuilder,
	DeviceActionStatus,
	InvalidStatusWordError,
	isSuccessCommandResult,
	OpenAppDeviceAction,
} from "@ledgerhq/device-management-kit";
import {
	webHidIdentifier,
	webHidTransportFactory,
} from "@ledgerhq/device-transport-kit-web-hid";
import { firstValueFrom } from "rxjs";

// ── Protocol constants (from LedgerHQ/app-hedera firmware) ────────────────────
const CLA = 0xe0;
const INS_GET_PUBLIC_KEY = 0x02;
const INS_SIGN_TRANSACTION = 0x04;
/** Ledger Live / device catalog name for the Hedera app. */
export const HEDERA_APP_NAME = "Hedera";
/** The device signs with the fixed path m/44'/3030'/0'/0'/<index>'. Index 0 = first account. */
export const DEFAULT_KEY_INDEX = 0;
/** Public derivation path (for display only — the device builds it from the index). */
export function hederaDerivationPath(index = DEFAULT_KEY_INDEX): string {
	return `m/44'/3030'/0'/0'/${index}'`;
}

const PUBKEY_LEN = 32;
const SIGNATURE_LEN = 64;
// APDU Lc is a single byte: index (4) + body must fit in 255. Bodies are ~150 B.
const MAX_BODY_BYTES = 255 - 4;

// ── Errors ────────────────────────────────────────────────────────────────────

export type LedgerErrorKind =
	| "rejected" // user pressed reject on the device — neutral/amber, not a failure
	| "locked" // device is PIN-locked
	| "wrong-app" // a different app is open / CLA not supported
	| "not-installed" // the Hedera app isn't installed
	| "no-device" // no device selected / discovery cancelled
	| "unsupported" // WebHID unavailable in this browser
	| "timeout" // the user never responded on-device
	| "transport" // USB/HID dropped
	| "unknown";

/** A classified, user-presentable Ledger failure. `message` is safe to render. */
export class LedgerError extends Error {
	readonly kind: LedgerErrorKind;
	readonly debug?: string;
	constructor(kind: LedgerErrorKind, message: string, debug?: string) {
		super(message);
		this.name = "LedgerError";
		this.kind = kind;
		this.debug = debug;
	}
}

const USER_MESSAGE: Record<LedgerErrorKind, string> = {
	rejected: "Action cancelled on the device.",
	locked: "Your Ledger is locked — enter your PIN on the device and try again.",
	"wrong-app": "Open the Hedera app on your Ledger and try again.",
	"not-installed":
		"The Hedera app isn't installed. Install it from Ledger Live, then try again.",
	"no-device": "No Ledger was selected. Click connect and pick your device.",
	unsupported:
		"This browser can't reach a Ledger over USB. Use desktop Chrome, Edge or Brave over HTTPS (or localhost).",
	timeout:
		"Timed out waiting for the Ledger. Reconnect the device and try again.",
	transport:
		"Lost the connection to the Ledger. Reconnect the device and try again.",
	unknown:
		"The Ledger returned an unexpected error. Reconnect the device and try again.",
};

/** Classify any thrown value (DMK device-action error, raw status word, transport) → LedgerError. */
export function toLedgerError(err: unknown): LedgerError {
	if (err instanceof LedgerError) return err;
	const e = err as
		| {
				_tag?: string;
				errorCode?: string;
				originalError?: { errorCode?: string };
				ledgerKind?: LedgerErrorKind;
				message?: string;
		  }
		| undefined;

	// Errors raised by our own command parser already carry a kind.
	if (e?.ledgerKind)
		return new LedgerError(e.ledgerKind, USER_MESSAGE[e.ledgerKind], e.message);

	const tag = e?._tag ?? "";
	const code = e?.errorCode ?? e?.originalError?.errorCode ?? "";

	let kind: LedgerErrorKind = "unknown";
	if (tag === "RefusedByUserDAError" || code === "5501" || code === "6985")
		kind = "rejected";
	else if (
		tag === "DeviceLockedError" ||
		code === "5515" ||
		code === "6982" ||
		code === "5303"
	)
		kind = "locked";
	else if (code === "6807") kind = "not-installed";
	else if (code === "6e00" || code === "6d00") kind = "wrong-app";
	else if (tag === "NoAccessibleDeviceError") kind = "no-device";
	else if (
		tag === "DeviceDisconnectedWhileSendingError" ||
		tag === "SendApduTimeoutError" ||
		tag === "OpeningConnectionError"
	)
		kind = "transport";

	return new LedgerError(kind, USER_MESSAGE[kind], e?.message ?? String(err));
}

/** Build a classified status-word error for a non-0x9000 APDU response. */
function statusWordError(response: ApduResponse): InvalidStatusWordError & {
	ledgerKind: LedgerErrorKind;
	statusWord: number;
} {
	const sc = response.statusCode;
	const sw = ((sc[0] ?? 0) << 8) | (sc[1] ?? 0);
	let kind: LedgerErrorKind = "unknown";
	if (CommandUtils.isRefusedByUser(response)) kind = "rejected";
	else if (CommandUtils.isLockedDeviceResponse(response)) kind = "locked";
	else if (sw === 0x6e00 || sw === 0x6d00) kind = "wrong-app";
	else if (sw === 0x6807) kind = "not-installed";
	const err = new InvalidStatusWordError(
		`Hedera app returned status 0x${sw.toString(16).padStart(4, "0")}`,
	) as InvalidStatusWordError & {
		ledgerKind: LedgerErrorKind;
		statusWord: number;
	};
	err.ledgerKind = kind;
	err.statusWord = sw;
	return err;
}

// ── hex helpers (no Buffer in the browser) ────────────────────────────────────

export function bytesToHex(bytes: Uint8Array): string {
	let out = "";
	for (const b of bytes) out += b.toString(16).padStart(2, "0");
	return out;
}

export function hexToBytes(hex: string): Uint8Array {
	const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
	if (clean.length % 2 !== 0)
		throw new Error("hex string must have an even length");
	const out = new Uint8Array(clean.length / 2);
	for (let i = 0; i < out.length; i++)
		out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
	return out;
}

/** index → 4 little-endian bytes (the firmware reads `U4LE(buffer, 0)`). */
function u32le(index: number): Uint8Array {
	const b = new Uint8Array(4);
	new DataView(b.buffer).setUint32(0, index >>> 0, true);
	return b;
}

// ── Custom APDU commands ──────────────────────────────────────────────────────

/** INS 0x02 — derive the Ed25519 public key for key `index` (path m/44'/3030'/0'/0'/index'). */
class HederaGetPublicKeyCommand implements Command<string> {
	readonly name = "HederaGetPublicKey";
	constructor(
		private readonly index: number,
		private readonly display: boolean,
	) {}

	getApdu() {
		return new ApduBuilder({
			cla: CLA,
			ins: INS_GET_PUBLIC_KEY,
			p1: this.display ? 0x00 : 0x01, // 0x00 shows "Export Public Key #x?"; 0x01 is silent
			p2: 0x00,
		})
			.addBufferToData(u32le(this.index))
			.build();
	}

	parseResponse(response: ApduResponse): CommandResult<string> {
		if (!CommandUtils.isSuccessResponse(response)) {
			return CommandResultFactory({ error: statusWordError(response) });
		}
		const pubkey = new ApduParser(response).extractFieldByLength(PUBKEY_LEN);
		if (!pubkey) {
			return CommandResultFactory({
				error: new InvalidStatusWordError("Hedera app returned no public key"),
			});
		}
		return CommandResultFactory({ data: bytesToHex(pubkey) });
	}
}

/** INS 0x04 — sign a serialized Hedera TransactionBody with key `index`; returns the raw 64-byte sig. */
class HederaSignTransactionCommand implements Command<Uint8Array> {
	readonly name = "HederaSignTransaction";
	constructor(
		private readonly index: number,
		private readonly body: Uint8Array,
	) {
		if (body.length === 0) throw new Error("empty transaction body");
		if (body.length > MAX_BODY_BYTES) {
			throw new Error(
				`transaction body too large for one APDU (${body.length} > ${MAX_BODY_BYTES})`,
			);
		}
	}

	getApdu() {
		return new ApduBuilder({
			cla: CLA,
			ins: INS_SIGN_TRANSACTION,
			p1: 0x00,
			p2: 0x00,
		})
			.addBufferToData(u32le(this.index)) // key index (LE)
			.addBufferToData(this.body) // raw TransactionBody — signed verbatim on device
			.build();
	}

	parseResponse(response: ApduResponse): CommandResult<Uint8Array> {
		if (!CommandUtils.isSuccessResponse(response)) {
			return CommandResultFactory({ error: statusWordError(response) });
		}
		const sig = new ApduParser(response).extractFieldByLength(SIGNATURE_LEN);
		if (!sig) {
			return CommandResultFactory({
				error: new InvalidStatusWordError("Hedera app returned no signature"),
			});
		}
		return CommandResultFactory({ data: sig });
	}
}

// ── DMK lifecycle + Hedera operations ─────────────────────────────────────────

/** True when this browser can reach a Ledger over WebHID. */
export function isWebHidSupported(): boolean {
	return (
		typeof navigator !== "undefined" &&
		Boolean((navigator as Navigator & { hid?: unknown }).hid)
	);
}

/** One DMK instance per app (the React card memoizes this). */
export function buildHederaDmk(): DeviceManagementKit {
	return new DeviceManagementKitBuilder()
		.addTransport(webHidTransportFactory)
		.build();
}

/** Prompt the WebHID picker (MUST be called from a user gesture) and open a session. */
export async function connectLedger(dmk: DeviceManagementKit): Promise<string> {
	if (!isWebHidSupported()) {
		throw new LedgerError("unsupported", USER_MESSAGE.unsupported);
	}
	try {
		// WebHID's picker guarantees exactly one device, so the first emission is the device.
		const device = await firstValueFrom(
			dmk.startDiscovering({ transport: webHidIdentifier }),
		);
		return await dmk.connect({ device });
	} catch (err) {
		throw toLedgerError(err);
	}
}

export async function disconnectLedger(
	dmk: DeviceManagementKit,
	sessionId: string,
): Promise<void> {
	try {
		await dmk.disconnect({ sessionId });
	} catch {
		/* best-effort: the session may already be gone */
	}
}

/** A coarse hint the UI can show while a device action is pending. */
export type LedgerPrompt =
	| "unlock" // enter PIN
	| "confirm-open-app" // approve opening the Hedera app
	| "review" // review/approve on screen
	| "working"; // processing, nothing to do

/**
 * Ensure the Hedera app is open (opens it via the DMK device action, which also handles
 * unlock + app-switch). Resolves once the app is open; rejects (classified) otherwise.
 */
export async function openHederaApp(
	dmk: DeviceManagementKit,
	sessionId: string,
	onPrompt?: (prompt: LedgerPrompt) => void,
	timeoutMs = 60_000,
): Promise<void> {
	const { observable, cancel } = dmk.executeDeviceAction({
		sessionId,
		deviceAction: new OpenAppDeviceAction({
			input: { appName: HEDERA_APP_NAME },
		}),
	});

	await new Promise<void>((resolve, reject) => {
		const timer = setTimeout(() => {
			cancel();
			reject(new LedgerError("timeout", USER_MESSAGE.timeout));
		}, timeoutMs);
		const done = (fn: () => void) => {
			clearTimeout(timer);
			sub.unsubscribe();
			fn();
		};
		const sub = observable.subscribe({
			next: (state) => {
				switch (state.status) {
					case DeviceActionStatus.Pending: {
						const ui = state.intermediateValue?.requiredUserInteraction;
						if (ui === "unlock-device") onPrompt?.("unlock");
						else if (ui === "confirm-open-app") onPrompt?.("confirm-open-app");
						else onPrompt?.("working");
						break;
					}
					case DeviceActionStatus.Completed:
						done(resolve);
						break;
					case DeviceActionStatus.Stopped:
						done(() =>
							reject(new LedgerError("rejected", USER_MESSAGE.rejected)),
						);
						break;
					case DeviceActionStatus.Error:
						done(() => reject(toLedgerError(state.error)));
						break;
					default:
						break;
				}
			},
			error: (err) => done(() => reject(toLedgerError(err))),
		});
	});
}

/**
 * Derive the account's Ed25519 public key (hex). `display:false` (default) reads it
 * silently — fine here because the load-bearing on-device confirmation is the signing
 * step, which shows sender + amount + memo on the trusted display.
 */
export async function getHederaPublicKey(
	dmk: DeviceManagementKit,
	sessionId: string,
	opts: { index?: number; display?: boolean } = {},
): Promise<string> {
	const result = await dmk.sendCommand({
		sessionId,
		command: new HederaGetPublicKeyCommand(
			opts.index ?? DEFAULT_KEY_INDEX,
			opts.display ?? false,
		),
	});
	if (!isSuccessCommandResult(result)) throw toLedgerError(result.error);
	return result.data;
}

/**
 * Sign a serialized Hedera TransactionBody on-device. The device shows the transfer
 * (sender, recipient, amount, fee) and the memo, then returns a 64-byte Ed25519 signature
 * over the exact `body` bytes.
 */
export async function signHederaTransactionBody(
	dmk: DeviceManagementKit,
	sessionId: string,
	body: Uint8Array,
	opts: { index?: number } = {},
): Promise<Uint8Array> {
	const result = await dmk.sendCommand({
		sessionId,
		command: new HederaSignTransactionCommand(
			opts.index ?? DEFAULT_KEY_INDEX,
			body,
		),
	});
	if (!isSuccessCommandResult(result)) throw toLedgerError(result.error);
	return result.data;
}
