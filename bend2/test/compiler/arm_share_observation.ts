import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { pathToFileURL } from "node:url";

// Content deduplication can merge equal C emitted by distinct source arms.
// Observe the emitter's new-arm decisions before that assembly step.
export async function observe_compiler(source: string): Promise<any> {
  const text = fs.readFileSync(source, "utf8");
  const marker = 'diagnostic("spin.emit", { kind: "arm",';
  if (!text.includes(marker)) return import(pathToFileURL(source).href);
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "bend-arm-sharing-"));
  fs.cpSync(path.dirname(source), temporary, { recursive: true });
  const file = path.join(temporary, "comp.ts");
  fs.writeFileSync(file, text.replace(marker, 'test_arm_count.value++;\n  ' + marker)
    + '\nexport const test_arm_count = { value: 0 };\n');
  process.on("exit", () => fs.rmSync(temporary, { recursive: true, force: true }));
  return import(pathToFileURL(file).href);
}
