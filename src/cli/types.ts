import type { BiDiConnection } from "../bidi/connection.js";

export interface CLICommand {
  name: string;
  aliases?: string[];
  description: string;
  usage: string;
  run: (bidi: BiDiConnection, args: string[]) => Promise<void>;
}
