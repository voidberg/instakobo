import { bold, cyan, dim, green, red, yellow } from "@std/fmt/colors";

/** Minimal leveled logger with a tiny terminal spinner for long steps. */
export const log = {
  info: (msg: string) => console.error(`${cyan("•")} ${msg}`),
  step: (msg: string) => console.error(`${dim("→")} ${msg}`),
  success: (msg: string) => console.error(`${green("✓")} ${msg}`),
  warn: (msg: string) => console.error(`${yellow("!")} ${msg}`),
  error: (msg: string) => console.error(`${red("✗")} ${msg}`),
  heading: (msg: string) => console.error(`\n${bold(msg)}`),
};

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export class Spinner {
  private timer?: ReturnType<typeof setInterval>;
  private frame = 0;
  private readonly interactive = Deno.stderr.isTerminal();

  constructor(private text: string) {}

  start(): this {
    if (!this.interactive) {
      log.step(this.text);
      return this;
    }
    this.timer = setInterval(() => {
      const f = FRAMES[this.frame++ % FRAMES.length];
      Deno.stderr.writeSync(new TextEncoder().encode(`\r${cyan(f!)} ${this.text} `));
    }, 80);
    return this;
  }

  private clear(): void {
    if (this.timer !== undefined) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    if (this.interactive) {
      Deno.stderr.writeSync(new TextEncoder().encode("\r\x1b[2K"));
    }
  }

  succeed(msg: string): void {
    this.clear();
    log.success(msg);
  }

  stop(): void {
    this.clear();
  }
}
