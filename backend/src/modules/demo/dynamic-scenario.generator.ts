import type { DemoScenarioDefinition } from "./demo.types.js";
import type { DataRequirement } from "../requirements/requirement.schema.js";
import type { WorkflowPlanDraft } from "../planner/workflow-plan.schema.js";
import type { AgentSourceMetadata, AgentRecord } from "../../agent/types.js";

interface EntityTemplate {
  entityType: string;
  defaultFields: Array<{ key: string; label: string; type: "string" | "number" | "url" | "currency" | "email" }>;
  requiredKeys: string[];
  dedupKeys: string[];
  sourceTypes: string[];
  preferredDomains: string[];
  buildRecords: (topic: string, count: number) => { sources: AgentSourceMetadata[]; records: AgentRecord[] };
}

const YOUTUBE_TEMPLATE: EntityTemplate = {
  entityType: "YouTube Channel",
  defaultFields: [
    { key: "channel_name", label: "Channel Name", type: "string" },
    { key: "channel_url", label: "Channel URL", type: "url" },
    { key: "subscribers", label: "Subscriber Count", type: "string" },
    { key: "primary_topics", label: "Primary Topics", type: "string" },
    { key: "creator", label: "Creator / Host", type: "string" },
    { key: "description", label: "Description", type: "string" },
    { key: "source_url", label: "Source URL", type: "url" },
  ],
  requiredKeys: ["channel_name", "channel_url", "subscribers", "primary_topics", "source_url"],
  dedupKeys: ["channel_url"],
  sourceTypes: ["Official YouTube Channels", "Developer Community Curations", "GitHub Awesome Lists"],
  preferredDomains: ["youtube.com", "github.com", "dev.to"],
  buildRecords: (topic: string, count: number) => {
    const now = new Date().toISOString();
    const sources: AgentSourceMetadata[] = [
      {
        url: "https://www.youtube.com/results?search_query=best+coding+channels",
        canonicalUrl: "https://www.youtube.com/results?search_query=best+coding+channels",
        domain: "youtube.com",
        title: "YouTube Directory — Top Programming & Coding Channels",
        snippet: "Curated catalog of top software engineering, web development, and coding tutorial channels.",
        sourceType: "search",
        retrievedAt: now,
        verifiedByTool: true,
      },
      {
        url: "https://github.com/freeCodeCamp/awesome-coding-channels",
        canonicalUrl: "https://github.com/freeCodeCamp/awesome-coding-channels",
        domain: "github.com",
        title: "GitHub Awesome List — Programming YouTube Creators",
        snippet: "Open source community index of high-reputation coding video creators and tutorials.",
        sourceType: "scrape",
        retrievedAt: now,
        verifiedByTool: true,
      },
      {
        url: "https://dev.to/t/youtube",
        canonicalUrl: "https://dev.to/t/youtube",
        domain: "dev.to",
        title: "DEV Community — Recommended YouTube Channels for Developers",
        snippet: "Peer-reviewed developer recommendations for modern web, systems, and algorithms channels.",
        sourceType: "scrape",
        retrievedAt: now,
        verifiedByTool: true,
      },
      {
        url: "https://unreachable-source.example.com/broken-channel-index",
        canonicalUrl: "https://unreachable-source.example.com/broken-channel-index",
        domain: "unreachable-source.example.com",
        title: "[DEMO] Stale Directory (404 Test)",
        snippet: "Simulated unreachable host for fault tolerance demonstration.",
        sourceType: "scrape",
        retrievedAt: now,
        verifiedByTool: false,
      },
    ];

    const channelPool = [
      { name: "freeCodeCamp.org", url: "https://www.youtube.com/@freecodecamp", subs: "9.8M", topics: "Python, Web Development, Fullstack, Algorithms", creator: "Quincy Larson", desc: "Open-source codebase and curriculum videos teaching coding for free." },
      { name: "Fireship", url: "https://www.youtube.com/@Fireship", subs: "3.2M", topics: "High-speed Tech News, 100 Seconds of Code, Web Dev", creator: "Jeff Delaney", desc: "Fast-paced code tutorials and engineering insights for modern builders." },
      { name: "Traversy Media", url: "https://www.youtube.com/@TraversyMedia", subs: "2.3M", topics: "Full Stack Web Development, JavaScript, React, Node", creator: "Brad Traversy", desc: "Practical crash courses and build-along projects from beginner to advanced." },
      { name: "The Net Ninja", url: "https://www.youtube.com/@NetNinja", subs: "1.4M", topics: "TypeScript, Flutter, Next.js, Vue, Tailwind CSS", creator: "Shaun Pelling", desc: "In-depth structured playlist series on contemporary frontend and mobile stacks." },
      { name: "Kevin Powell", url: "https://www.youtube.com/@KevinPowell", subs: "1.1M", topics: "CSS, Responsive Layouts, Flexbox, Grid, Modern UI", creator: "Kevin Powell", desc: "The definitive guide to demystifying CSS and creating accessible responsive web layouts." },
      { name: "Web Dev Simplified", url: "https://www.youtube.com/@WebDevSimplified", subs: "1.6M", topics: "React, Clean Code, JavaScript, Node.js", creator: "Kyle Cook", desc: "Simplifying difficult web concepts and teaching production architecture patterns." },
      { name: "Programming with Mosh", url: "https://www.youtube.com/@programmingwithmosh", subs: "3.9M", topics: "Python, C#, JavaScript, SQL, Data Structures", creator: "Mosh Hamedani", desc: "Clear, structured tutorials for career software engineers." },
      { name: "CS50", url: "https://www.youtube.com/@cs50", subs: "1.9M", topics: "Computer Science Foundations, C, Python, Memory Management", creator: "David J. Malan (Harvard)", desc: "Harvard University's introduction to the intellectual enterprises of computer science." },
      { name: "Bro Code", url: "https://www.youtube.com/@BroCodez", subs: "2.2M", topics: "C++, Java, Python, C#, Complete Beginner to Pro", creator: "Bro Code", desc: "Comprehensive multi-hour comprehensive coding walkthroughs." },
      { name: "Academind", url: "https://www.youtube.com/@Academind", subs: "970K", topics: "Angular, React, Vue, Docker, AWS, NestJS", creator: "Maximilian Schwarzmüller", desc: "Practical full-stack development, modern framework mechanics and DevOps." },
      { name: "NeetCode", url: "https://www.youtube.com/@NeetCode", subs: "780K", topics: "Algorithms, Data Structures, System Design, LeetCode", creator: "Navdeep Singh", desc: "Visual step-by-step algorithms and technical interview problem solving." },
      { name: "ThePrimeagen", url: "https://www.youtube.com/@ThePrimeagen", subs: "520K", topics: "Rust, Go, Neovim, Software Architecture, Low-level", creator: "Michael Paulson", desc: "High-energy engineering discussions, vim mastery, and systems engineering." },
      { name: "Tech With Tim", url: "https://www.youtube.com/@TechWithTim", subs: "1.4M", topics: "Python, Machine Learning, Game Development, FastAPI", creator: "Tim Ruscica", desc: "Hands-on projects covering AI, automation, and backend engineering." },
      { name: "Hussein Nasser", url: "https://www.youtube.com/@hnasr", subs: "430K", topics: "Backend Engineering, Databases, Networking, Proxies", creator: "Hussein Nasser", desc: "Deep engineering dives into distributed systems, protocols, and database internals." },
      { name: "Derek Banas", url: "https://www.youtube.com/@derekbanas", subs: "1.3M", topics: "Learn In One Video, AI, Machine Learning, Kotlin", creator: "Derek Banas", desc: "Rapid accelerated language overviews and comprehensive programming guides." },
    ];

    const records: AgentRecord[] = [];
    const target = Math.min(count, channelPool.length);
    for (let i = 0; i < target; i++) {
      const ch = channelPool[i];
      if (!ch) continue;
      const primarySource = sources[0]?.url || "https://www.youtube.com";
      const secondarySource = sources[1]?.url || primarySource;
      const sourceUrl = i % 2 === 0 ? primarySource : secondarySource;
      records.push({
        values: {
          channel_name: ch.name,
          channel_url: ch.url,
          subscribers: ch.subs,
          primary_topics: ch.topics,
          creator: ch.creator,
          description: ch.desc,
          source_url: sourceUrl,
        },
        rawValues: {
          channel_name: ch.name,
          subscribers: ch.subs,
          _isDemoSimulated: true,
        },
        sourceUrls: [sourceUrl],
      });
    }

    return { sources, records };
  },
};

function getTemplate(prompt: string): EntityTemplate {
  const p = prompt.toLowerCase();
  if (p.includes("youtube") || p.includes("channel") || p.includes("video") || p.includes("coding")) {
    return YOUTUBE_TEMPLATE;
  }

  // General fallback template
  return {
    entityType: "Directory Record",
    defaultFields: [
      { key: "name", label: "Name / Title", type: "string" },
      { key: "website", label: "Website / URL", type: "url" },
      { key: "category", label: "Category / Domain", type: "string" },
      { key: "description", label: "Description", type: "string" },
      { key: "source_url", label: "Source URL", type: "url" },
    ],
    requiredKeys: ["name", "website", "source_url"],
    dedupKeys: ["website"],
    sourceTypes: ["Official Domain", "Industry Directory", "Curated Index"],
    preferredDomains: [],
    buildRecords: (_topic: string, count: number) => {
      const now = new Date().toISOString();
      const primaryUrl = "https://directory.example.com/curated-index";
      const sources: AgentSourceMetadata[] = [
        {
          url: primaryUrl,
          canonicalUrl: primaryUrl,
          domain: "directory.example.com",
          title: "Curated Directory Index",
          snippet: "Verified reference directory for matching domain entities.",
          sourceType: "search",
          retrievedAt: now,
          verifiedByTool: true,
        },
      ];
      const records: AgentRecord[] = [];
      const num = Math.min(count, 10);
      for (let i = 1; i <= num; i++) {
        const url = `https://example.com/item-${i}`;
        records.push({
          values: {
            name: `Item ${i}`,
            website: url,
            category: "General",
            description: `Verified record matching prompt criteria #${i}`,
            source_url: primaryUrl,
          },
          rawValues: {
            name: `Item ${i}`,
            _isDemoSimulated: true,
          },
          sourceUrls: [primaryUrl],
        });
      }
      return { sources, records };
    },
  };
}

export function createDynamicDemoScenario(prompt: string): DemoScenarioDefinition {
  const template = getTemplate(prompt);
  const now = new Date().toISOString();

  // Extract count if prompt has numbers like "50", "20", "100"
  const countMatch = prompt.match(/\b(\d{1,3})\b/);
  const targetCount = countMatch && countMatch[1] ? Math.min(100, Math.max(5, parseInt(countMatch[1], 10))) : 25;

  const titleTopic = prompt
    .replace(/^(find|collect|get|search for|list|scrape)\s+/i, "")
    .trim();

  const entity = template.entityType;
  const fields = template.defaultFields.map((f) => ({
    key: f.key,
    label: f.label,
    type: f.type,
    description: null,
  }));

  const requiredFields = template.requiredKeys.filter((k) => fields.some((f) => f.key === k));
  const optionalFields = fields
    .map((f) => f.key)
    .filter((k) => !requiredFields.includes(k));

  const requirement: DataRequirement = {
    objective: `Collect a curated dataset of ${entity} records for: ${titleTopic || prompt}`,
    entityType: entity,
    quantity: targetCount,
    geography: {
      places: [],
      scope: "unspecified",
      includeSubregions: null,
    },
    timeRange: {
      field: null,
      after: null,
      before: null,
      on: null,
      expression: null,
    },
    filters: [
      {
        field: fields[0]?.key || "name",
        operator: "exists",
        value: true,
      },
    ],
    constraints: [
      `Target verified public ${entity} sources only`,
      "Must have active valid URL and description",
    ],
    fields,
    requiredFields,
    optionalFields,
    sourcePreferences: template.sourceTypes,
    sourceRestrictions: [],
    deduplicationKeys: template.dedupKeys,
    validationRules: [
      {
        fieldKey: fields[0]?.key || null,
        rule: "REQUIRED",
        description: `${fields[0]?.label || "Primary name"} must be non-empty`,
        severity: "error",
      },
    ],
    outputFormat: "unspecified",
    ambiguities: [],
    missingInformation: [],
    warnings: [],
  };

  const { sources, records } = template.buildRecords(titleTopic, targetCount);

  // Build schema-compliant WorkflowPlanDraft
  const extractionProperties: Record<string, { type: "string" | "number"; description: string }> = {};
  for (const f of fields) {
    extractionProperties[f.key] = {
      type: f.type === "number" ? "number" : "string",
      description: f.label,
    };
  }

  const plan: WorkflowPlanDraft = {
    objective: requirement.objective!,
    constraints: requirement.constraints,
    sourcePolicy: {
      permittedSourceTypes: ["official_website", "other"],
      allowedDomains: [],
      preferredDomains: template.preferredDomains,
      blockedDomains: [],
      respectRobotsTxt: true,
      respectSiteTerms: true,
      allowAuthentication: false,
      allowCaptchaBypass: false,
      maxRequestsPerDomainPerMinute: 15,
      policyRationale: "Public directory indexing adhering to site terms and robots.txt.",
    },
    searchStrategy: {
      queries: [
        {
          query: `${prompt} directory`,
          sourceType: "other",
          rationale: "Discover authoritative candidate listing pages",
        },
        {
          query: `top ${titleTopic} recommendations`,
          sourceType: "other",
          rationale: "Identify peer-reviewed lists and community references",
        },
      ],
      desiredSourceCount: Math.min(10, sources.length),
      maximumSourceCount: 20,
      selectionRationale: "Gather multi-source corroboration across public indices.",
    },
    steps: [
      {
        id: "step-1-search",
        type: "SEARCH",
        description: `Search public sources for ${entity} listings`,
        input: {},
        configuration: {},
        dependencies: [],
        retryPolicy: {
          maxAttempts: 3,
          backoff: "exponential",
          initialDelayMs: 1000,
          multiplier: 2,
          maxDelayMs: 10000,
          retryableErrors: ["TIMEOUT", "TRANSIENT_NETWORK"],
        },
        timeoutMs: 30000,
        expectedOutput: "Candidate source URLs",
        status: "PENDING",
      },
      {
        id: "step-2-scrape",
        type: "SCRAPE",
        description: `Scrape content from discovered ${entity} pages`,
        input: {},
        configuration: {},
        dependencies: ["step-1-search"],
        retryPolicy: {
          maxAttempts: 3,
          backoff: "exponential",
          initialDelayMs: 1000,
          multiplier: 2,
          maxDelayMs: 10000,
          retryableErrors: ["TIMEOUT", "TRANSIENT_NETWORK", "RATE_LIMIT"],
        },
        timeoutMs: 45000,
        expectedOutput: "Raw HTML / markdown page content",
        status: "PENDING",
      },
      {
        id: "step-3-extract",
        type: "EXTRACT",
        description: `Extract structured ${entity} records matching defined fields`,
        input: {},
        configuration: {},
        dependencies: ["step-2-scrape"],
        retryPolicy: {
          maxAttempts: 1,
          backoff: "none",
          initialDelayMs: 0,
          multiplier: 1,
          maxDelayMs: 0,
          retryableErrors: [],
        },
        timeoutMs: 30000,
        expectedOutput: "Structured record collection with provenance",
        status: "PENDING",
      },
      {
        id: "step-4-validate",
        type: "VALIDATE",
        description: `Validate field constraints and URLs for ${entity} records`,
        input: {},
        configuration: {},
        dependencies: ["step-3-extract"],
        retryPolicy: {
          maxAttempts: 1,
          backoff: "none",
          initialDelayMs: 0,
          multiplier: 1,
          maxDelayMs: 0,
          retryableErrors: [],
        },
        timeoutMs: 15000,
        expectedOutput: "Validated records with issue reports",
        status: "PENDING",
      },
      {
        id: "step-5-deduplicate",
        type: "DEDUPLICATE",
        description: `Deduplicate records using primary identity key (${template.dedupKeys.join(", ")})`,
        input: {},
        configuration: {},
        dependencies: ["step-4-validate"],
        retryPolicy: {
          maxAttempts: 1,
          backoff: "none",
          initialDelayMs: 0,
          multiplier: 1,
          maxDelayMs: 0,
          retryableErrors: [],
        },
        timeoutMs: 15000,
        expectedOutput: "Unique record dataset",
        status: "PENDING",
      },
      {
        id: "step-6-save",
        type: "SAVE",
        description: "Persist dataset and execution metrics to database",
        input: {},
        configuration: {},
        dependencies: ["step-5-deduplicate"],
        retryPolicy: {
          maxAttempts: 3,
          backoff: "exponential",
          initialDelayMs: 1000,
          multiplier: 2,
          maxDelayMs: 10000,
          retryableErrors: ["TIMEOUT", "SERVER_ERROR"],
        },
        timeoutMs: 30000,
        expectedOutput: "Persisted dataset entity",
        status: "PENDING",
      },
    ],
    extractionSchema: {
      type: "object",
      properties: extractionProperties,
      required: requiredFields,
      additionalProperties: false,
    },
    transformations: [
      {
        fieldKey: fields[0]?.key || null,
        operation: "TRIM_WHITESPACE",
        description: "Trim extra whitespace from entity names",
      },
    ],
    validationRules: [
      {
        fieldKey: fields[0]?.key || null,
        rule: "REQUIRED",
        severity: "ERROR",
        description: "Entity primary identifier must be present",
      },
    ],
    deduplicationRules: [
      {
        keys: template.dedupKeys,
        strategy: "NORMALIZED",
        confidenceThreshold: 0.95,
        ambiguousMatchAction: "KEEP_SEPARATE",
        rationale: "Deduplicate based on normalized canonical identifier",
      },
    ],
    completionCriteria: {
      targetRecordCount: targetCount,
      minimumSources: 1,
      requiredFieldsPresent: requiredFields,
      requireSourceEvidence: true,
      stopWhenTargetReached: true,
      allowPartialResults: true,
      completionDescription: `Successfully collected ${targetCount} ${entity} records`,
    },
    outputConfiguration: {
      format: "unspecified",
      expectedColumns: fields.map((f) => f.key),
      includeSourceEvidence: true,
    },
  };

  return {
    id: `scenario-dynamic-${Date.now()}`,
    name: `${entity} Collection: ${titleTopic || prompt}`,
    scenarioNumber: 4,
    canonicalPrompt: prompt,
    description: `Dynamic workflow scenario for prompt: ${prompt}`,
    match: () => true,
    requirement,
    plan,
    sources,
    records,
    expectedMetrics: {
      targetCount,
      rawRecordCount: records.length,
      validRecordCount: records.length,
      duplicateCount: 0,
      conflictCount: 0,
      sourceCount: sources.length,
    },
  };
}
