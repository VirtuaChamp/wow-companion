import type { CompanionToGame, GameLink } from "@wow-companion/contracts";
import { SLOT_BYTE_CAP, SLOT_WARNING_THRESHOLD, messageByteSize } from "../transport/slots.ts";

const SIZING_SESSION = "x".repeat(17);

type HistoryMessage = Extract<CompanionToGame, { t: "history" }>;

export type Sender = {
  send(msg: CompanionToGame): void;
  sendAll(messages: readonly CompanionToGame[]): void;
};

function fitsInSlot(msg: CompanionToGame): boolean {
  return messageByteSize(SIZING_SESSION, msg) <= SLOT_BYTE_CAP;
}

function newestHistoryThatFits(msg: HistoryMessage): HistoryMessage {
  if (fitsInSlot(msg)) return msg;
  const total = msg.lines.length;
  const tail = (count: number): HistoryMessage => ({
    ...msg,
    lines: msg.lines.slice(total - count),
  });
  let low = 0;
  let high = total - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (fitsInSlot(tail(middle))) low = middle;
    else high = middle - 1;
  }
  return tail(low);
}

export function createSender(link: GameLink, log: (line: string) => void): Sender {
  let lastWarnedSlots: number | undefined;

  function warnWhenSlotsRunLow(): void {
    const left = link.status().slotsLeft;
    if (left <= SLOT_WARNING_THRESHOLD && left !== lastWarnedSlots) {
      lastWarnedSlots = left;
      log(`${String(left)} reply slots left: /reload in the game before they run out`);
    }
  }

  function send(original: CompanionToGame): void {
    const msg = original.t === "history" ? newestHistoryThatFits(original) : original;
    const result = link.send(msg);
    if (result.ok) {
      warnWhenSlotsRunLow();
      return;
    }
    switch (result.error) {
      case "too_large": {
        if (msg.t === "reply") {
          const notice = link.send({
            t: "error",
            id: msg.id,
            chat: msg.chat,
            code: "too_large",
            message: "the reply is too large to deliver",
          });
          if (!notice.ok) log("too_large notice could not be delivered");
          return;
        }
        log(`${msg.t} message is too large to deliver`);
        return;
      }
      case "slots_exhausted":
        log(
          "reply slots exhausted: close start.cmd, run install.cmd (or pnpm run addon:setup), then restart the game",
        );
        return;
    }
  }

  return {
    send,
    sendAll(messages) {
      for (const msg of messages) send(msg);
    },
  };
}
