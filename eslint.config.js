import eslint from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["**/dist/**", "**/node_modules/**", "packages/firecrawl-agent-core/**"] },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["backend/**/*.ts"],
    languageOptions: { globals: { ...globals.node, ...globals.vitest } },
    rules: {
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-explicit-any": "error"
    }
  }
);
