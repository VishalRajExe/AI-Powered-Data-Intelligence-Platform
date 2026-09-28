import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openApiSpecification } from "../docs/openapi.spec.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outputDir = path.resolve(__dirname, "../../docs");
const outputFile = path.join(outputDir, "openapi.json");

fs.mkdirSync(outputDir, { recursive: true });
fs.writeFileSync(outputFile, JSON.stringify(openApiSpecification, null, 2), "utf8");

console.log(`Successfully generated OpenAPI JSON: ${outputFile}`);
