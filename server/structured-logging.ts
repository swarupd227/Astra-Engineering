/**
 * Install structured JSON console output as early as possible in the server boot sequence.
 */
import { installStructuredConsole } from "./logger";

installStructuredConsole();
