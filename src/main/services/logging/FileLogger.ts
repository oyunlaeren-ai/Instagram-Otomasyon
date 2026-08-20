import fs from "node:fs";
import path from "node:path";

const MAX_BYTES = 2_000_000;
const KEEP_ARCHIVES = 5;

export class RotatingFileLogger {
  constructor(private readonly directory: string) {
    fs.mkdirSync(directory, { recursive: true });
  }

  write(stream: "app" | "error", line: string): void {
    const file = path.join(this.directory, `${stream}.log`);
    fs.appendFileSync(file, `${new Date().toISOString()} ${line}\n`, "utf8");
    this.rotate(file, stream);
  }

  private rotate(file: string, stream: string): void {
    if (!fs.existsSync(file) || fs.statSync(file).size < MAX_BYTES) {
      return;
    }
    const archive = path.join(this.directory, `${stream}.${Date.now()}.log`);
    fs.renameSync(file, archive);
    const archives = fs
      .readdirSync(this.directory)
      .filter((name) => name.startsWith(`${stream}.`) && name.endsWith(".log") && name !== `${stream}.log`)
      .sort();
    while (archives.length > KEEP_ARCHIVES) {
      const oldest = archives.shift();
      if (oldest) {
        fs.unlinkSync(path.join(this.directory, oldest));
      }
    }
  }
}
