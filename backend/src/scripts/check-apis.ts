import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { generateText } from "ai";
import Firecrawl from "firecrawl";
import { createAgent, buildFirecrawlToolkit } from "@aidp/firecrawl-agent-core";

async function checkApis() {
  console.log("=== Checking API Configurations & Imports ===");

  // 1. Check Firecrawl Agent Core imports
  console.log("\n1. Firecrawl Agent Core Workspace Package:");
  try {
    if (typeof createAgent === "function" && typeof buildFirecrawlToolkit === "function") {
      console.log("  ✅ @aidp/firecrawl-agent-core loaded successfully and factory functions exist.");
    } else {
      console.log("  ❌ @aidp/firecrawl-agent-core loaded but expected exports missing.");
    }
  } catch (err: any) {
    console.error("  ❌ Failed to load @aidp/firecrawl-agent-core:", err.message);
  }

  // 2. Check Gemini / Google GenAI Key
  console.log("\n2. Google Gemini / GenAI API:");
  const geminiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  if (!geminiKey) {
    console.log("  ⚠️ GEMINI_API_KEY / GOOGLE_GENERATIVE_AI_API_KEY not set in environment.");
  } else {
    console.log(`  Key detected: ${geminiKey.slice(0, 8)}... (length: ${geminiKey.length})`);
    try {
      const google = createGoogleGenerativeAI({ apiKey: geminiKey });
      const response = await generateText({
        model: google("gemini-2.5-flash"),
        prompt: "Say 'API is active' in 3 words.",
      });
      console.log("  ✅ Gemini API is WORKING! Response:", response.text.trim());
    } catch (err: any) {
      console.error("  ❌ Gemini API Call Failed:", err.message);
    }
  }

  // 3. Check Firecrawl API Key
  console.log("\n3. Firecrawl API:");
  const firecrawlKey = process.env.FIRECRAWL_API_KEY;
  if (!firecrawlKey) {
    console.log("  ⚠️ FIRECRAWL_API_KEY not set in environment or .env");
  } else {
    console.log(`  Key detected: ${firecrawlKey.slice(0, 6)}... (length: ${firecrawlKey.length})`);
    try {
      const app = new Firecrawl({ apiKey: firecrawlKey });
      console.log("  Testing Firecrawl API connectivity...");
      const scrapeResult = await app.scrape("https://example.com", { formats: ["markdown"] });
      if (scrapeResult && (scrapeResult as any).markdown) {
        console.log("  ✅ Firecrawl API is WORKING! Scraped example.com markdown length:", (scrapeResult as any).markdown.length);
      } else {
        console.log("  ⚠️ Firecrawl responded:", scrapeResult);
      }
    } catch (err: any) {
      console.error("  ❌ Firecrawl API Call Failed:", err.message);
    }
  }

  console.log("\n=== API Check Complete ===");
}

checkApis().catch(console.error);
