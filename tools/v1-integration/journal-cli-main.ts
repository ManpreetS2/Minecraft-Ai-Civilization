import { checkJournal } from "./journal-cli.js";
try {
  const result = checkJournal(process.argv.slice(2));
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.exitCode;
} catch (error) {
  console.error(String(error));
  process.exitCode = 1;
}
