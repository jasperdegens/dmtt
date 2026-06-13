// components/chat/types.ts — shared view types for the chat shell (WS-E).
//
// Pure view types only. The authoritative machine types live in lib/chat-machine.ts;
// these describe what the message list renders. (app/components MAY use @/ aliases.)

import type { ChatState } from "@/lib/chat-machine.ts";

export type Role = "system" | "user" | "assistant";

export interface ChatMessage {
  id: string;
  role: Role;
  text: string;
}

/** The fixed, ordered setup ladder the step indicator renders. */
export const STEP_ORDER: ChatState[] = ["IDLE", "MEMO", "TERMS", "WORLD", "SIGN", "ARMED"];

export const STEP_LABEL: Record<ChatState, string> = {
  IDLE: "Start",
  MEMO: "Memo",
  TERMS: "Terms",
  WORLD: "World ID",
  SIGN: "Sign",
  ARMED: "Armed",
  CHECKIN: "Check-in",
  CANCEL: "Cancel",
};
