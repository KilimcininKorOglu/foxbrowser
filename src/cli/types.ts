import type { CDPConnection } from "../cdp/connection.js";

export interface CLICommand {
  name: string;
  aliases?: string[];
  description: string;
  usage: string;
  run: (cdp: CDPConnection, args: string[]) => Promise<void>;
}
