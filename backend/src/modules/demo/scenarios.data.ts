import type { DemoScenarioDefinition } from "./demo.types.js";
import type { AgentSourceMetadata, AgentRecord } from "../../agent/types.js";

const now = new Date().toISOString();

// ============================================================================
// SCENARIO 1: 100 Indian AI Startups Founded After 2020
// ============================================================================

const SCENARIO_1_PROMPT =
  "Find 100 AI startups in India founded after 2020 with company name, founder, website, funding and location.";

const scenario1Sources: AgentSourceMetadata[] = [
  { url: "https://sarvam.ai", canonicalUrl: "https://sarvam.ai/", domain: "sarvam.ai", title: "[DEMO] Sarvam AI — Indic LLM Platform", snippet: "[SIMULATED PROVENANCE] Sarvam AI was founded in 2023 by Vivek Raghavan and Pratyush Kumar in Bengaluru, raising Series A funding.", sourceType: "scrape", retrievedAt: now, verifiedByTool: true },
  { url: "https://karya.ai", canonicalUrl: "https://karya.ai/", domain: "karya.ai", title: "[DEMO] Karya — Ethical AI Data", snippet: "[SIMULATED PROVENANCE] Karya was founded in 2021 by Manu Chopra in Bengaluru, raising Seed capital.", sourceType: "scrape", retrievedAt: now, verifiedByTool: true },
  { url: "https://krutrim.ai", canonicalUrl: "https://krutrim.ai/", domain: "krutrim.ai", title: "[DEMO] Krutrim — India's Sovereign AI", snippet: "[SIMULATED PROVENANCE] Krutrim was launched in 2023 by Bhavish Aggarwal in Bengaluru, reaching Unicorn status.", sourceType: "scrape", retrievedAt: now, verifiedByTool: true },
  { url: "https://corover.ai", canonicalUrl: "https://corover.ai/", domain: "corover.ai", title: "[DEMO] CoRover.ai — Conversational AI", snippet: "[SIMULATED PROVENANCE] CoRover was founded by Ankush Sabharwal in Bengaluru, creator of BharatGPT.", sourceType: "scrape", retrievedAt: now, verifiedByTool: true },
  { url: "https://gnani.ai", canonicalUrl: "https://gnani.ai/", domain: "gnani.ai", title: "[DEMO] Gnani.ai — Speech Intelligence", snippet: "[SIMULATED PROVENANCE] Gnani.ai was founded in Bengaluru by Ganesh Gopalan, raising Series A.", sourceType: "scrape", retrievedAt: now, verifiedByTool: true },
  { url: "https://avataar.me", canonicalUrl: "https://avataar.me/", domain: "avataar.me", title: "[DEMO] Avataar 3D AI", snippet: "[SIMULATED PROVENANCE] Avataar was founded in 2021 by Sravanth Aluru in Bengaluru, raising Series B.", sourceType: "scrape", retrievedAt: now, verifiedByTool: true },
  { url: "https://rephrase.ai", canonicalUrl: "https://rephrase.ai/", domain: "rephrase.ai", title: "[DEMO] Rephrase.ai Generative Video", snippet: "[SIMULATED PROVENANCE] Rephrase.ai was founded by Ashray Malhotra in Bengaluru, raising Series A.", sourceType: "scrape", retrievedAt: now, verifiedByTool: true },
  { url: "https://skit.ai", canonicalUrl: "https://skit.ai/", domain: "skit.ai", title: "[DEMO] Skit.ai Voice Automation", snippet: "[SIMULATED PROVENANCE] Skit.ai was founded by Sourabh Gupta in Bengaluru, raising Series B.", sourceType: "scrape", retrievedAt: now, verifiedByTool: true },
  { url: "https://entropiktech.com", canonicalUrl: "https://entropiktech.com/", domain: "entropiktech.com", title: "[DEMO] Entropik Emotion AI", snippet: "[SIMULATED PROVENANCE] Entropik was founded by Ranjan Kumar in Bengaluru, raising Series B.", sourceType: "scrape", retrievedAt: now, verifiedByTool: true },
  { url: "https://staqu.com", canonicalUrl: "https://staqu.com/", domain: "staqu.com", title: "[DEMO] Staqu Technologies Video AI", snippet: "[SIMULATED PROVENANCE] Staqu Technologies was founded by Atul Rai in Gurgaon.", sourceType: "scrape", retrievedAt: now, verifiedByTool: true },
  { url: "https://neuropixel.ai", canonicalUrl: "https://neuropixel.ai/", domain: "neuropixel.ai", title: "[DEMO] Neuropixel.ai Apparel AI", snippet: "[SIMULATED PROVENANCE] Neuropixel.ai was founded in 2021 by Kedar Katre in Bengaluru.", sourceType: "scrape", retrievedAt: now, verifiedByTool: true },
  { url: "https://devrev.ai", canonicalUrl: "https://devrev.ai/", domain: "devrev.ai", title: "[DEMO] DevRev AI Support & Engineering", snippet: "[SIMULATED PROVENANCE] DevRev was founded in 2021 by Dheeraj Pandey in Bengaluru, raising Series A.", sourceType: "scrape", retrievedAt: now, verifiedByTool: true },
  { url: "https://murf.ai", canonicalUrl: "https://murf.ai/", domain: "murf.ai", title: "[DEMO] Murf AI Synthetic Voice", snippet: "[SIMULATED PROVENANCE] Murf AI was founded in 2020 by Sneha Roy in Salt Lake City & Gurgaon, Series A.", sourceType: "scrape", retrievedAt: now, verifiedByTool: true },
  { url: "https://invideo.io", canonicalUrl: "https://invideo.io/", domain: "invideo.io", title: "[DEMO] InVideo AI Video Creation", snippet: "[SIMULATED PROVENANCE] InVideo was founded by Sanket Shah in Mumbai, Series A.", sourceType: "scrape", retrievedAt: now, verifiedByTool: true },
  { url: "https://beatoven.ai", canonicalUrl: "https://beatoven.ai/", domain: "beatoven.ai", title: "[DEMO] Beatoven.ai Music AI", snippet: "[SIMULATED PROVENANCE] Beatoven.ai was founded in 2021 by Mansoor Rahimat Khan in Bengaluru.", sourceType: "scrape", retrievedAt: now, verifiedByTool: true },
  { url: "https://inc42.com/reports/indian-ai-startups-2024", canonicalUrl: "https://inc42.com/reports/indian-ai-startups-2024", domain: "inc42.com", title: "[DEMO] Inc42 Indian AI Startup Ecosystem Report", snippet: "[SIMULATED PROVENANCE] Comprehensive directory of funded generative and applied AI ventures across India.", sourceType: "search", retrievedAt: now, verifiedByTool: true },
  { url: "https://yourstory.com/companies/ai-startups-india", canonicalUrl: "https://yourstory.com/companies/ai-startups-india", domain: "yourstory.com", title: "[DEMO] YourStory AI Startup Tracker", snippet: "[SIMULATED PROVENANCE] Curated profiles of deeptech and enterprise artificial intelligence startups.", sourceType: "search", retrievedAt: now, verifiedByTool: true },
  { url: "https://tracxn.com/explore/Artificial-Intelligence-Startups-in-India", canonicalUrl: "https://tracxn.com/explore/Artificial-Intelligence-Startups-in-India", domain: "tracxn.com", title: "[DEMO] Tracxn Indian AI Startup Directory", snippet: "[SIMULATED PROVENANCE] Directory listing of over 100 Indian AI startups with rounds and founders.", sourceType: "search", retrievedAt: now, verifiedByTool: true },
  // Fault-tolerant broken source to demonstrate run resilience
  { url: "https://unreachable-source.example.com/404", canonicalUrl: "https://unreachable-source.example.com/404", domain: "unreachable-source.example.com", title: "[DEMO] Broken Directory (404 Test)", snippet: "Failed to connect to host", sourceType: "scrape", retrievedAt: now, verifiedByTool: false },
];

const indianAiStartupNames = [
  { name: "Sarvam AI", founder: "Vivek Raghavan, Pratyush Kumar", website: "https://sarvam.ai", funding: "Series A", location: "Bengaluru" },
  { name: "Karya", founder: "Manu Chopra", website: "https://karya.ai", funding: "Seed", location: "Bengaluru" },
  { name: "Krutrim", founder: "Bhavish Aggarwal", website: "https://krutrim.ai", funding: "Series A", location: "Bengaluru" },
  { name: "CoRover.ai", founder: "Ankush Sabharwal", website: "https://corover.ai", funding: "Seed", location: "Bengaluru" },
  { name: "Gnani.ai", founder: "Ganesh Gopalan", website: "https://gnani.ai", funding: "Series A", location: "Bengaluru" },
  { name: "Avataar", founder: "Sravanth Aluru", website: "https://avataar.me", funding: "Series B", location: "Bengaluru" },
  { name: "Rephrase.ai", founder: "Ashray Malhotra", website: "https://rephrase.ai", funding: "Series A", location: "Bengaluru" },
  { name: "Skit.ai", founder: "Sourabh Gupta", website: "https://skit.ai", funding: "Series B", location: "Bengaluru" },
  { name: "Entropik Tech", founder: "Ranjan Kumar", website: "https://entropiktech.com", funding: "Series B", location: "Bengaluru" },
  { name: "Staqu Technologies", founder: "Atul Rai", website: "https://staqu.com", funding: "Pre-Series A", location: "Gurgaon" },
  { name: "Neuropixel.ai", founder: "Kedar Katre", website: "https://neuropixel.ai", funding: "Seed", location: "Bengaluru" },
  { name: "DevRev", founder: "Dheeraj Pandey", website: "https://devrev.ai", funding: "Series A", location: "Bengaluru" },
  { name: "Murf AI", founder: "Sneha Roy", website: "https://murf.ai", funding: "Series A", location: "Gurgaon" },
  { name: "InVideo", founder: "Sanket Shah", website: "https://invideo.io", funding: "Series A", location: "Mumbai" },
  { name: "Beatoven.ai", founder: "Mansoor Rahimat Khan", website: "https://beatoven.ai", funding: "Seed", location: "Bengaluru" },
  { name: "Segmind", founder: "Rohit Ramesh", website: "https://segmind.com", funding: "Seed", location: "Bengaluru" },
  { name: "Dubverse.ai", founder: "Varshul Goyal", website: "https://dubverse.ai", funding: "Seed", location: "Gurgaon" },
  { name: "Blend", founder: "Vishwanath Kollapudi", website: "https://blend.to", funding: "Seed", location: "Bengaluru" },
  { name: "Detect Technologies", founder: "Daniel Raj David", website: "https://detecttechnologies.com", funding: "Series B", location: "Chennai" },
  { name: "Synapsica", founder: "Meenakshi Singh", website: "https://synapsica.com", funding: "Series A", location: "Delhi NCR" },
  { name: "DeepTek", founder: "Amit Kharat", website: "https://deeptek.ai", funding: "Series A", location: "Pune" },
  { name: "Intello Labs", founder: "Milan Sharma", website: "https://intellolabs.com", funding: "Series B", location: "Gurgaon" },
  { name: "Qure.ai", founder: "Prashant Warier", website: "https://qure.ai", funding: "Series C", location: "Mumbai" },
  { name: "Sigmoid", founder: "Lokesh Anand", website: "https://sigmoid.com", funding: "Series B", location: "Bengaluru" },
  { name: "Netradyne", founder: "Avneesh Agrawal", website: "https://netradyne.com", funding: "Series C", location: "Bengaluru" },
  { name: "Mad Street Den", founder: "Ashwini Asokan", website: "https://madstreetden.com", funding: "Series C", location: "Chennai" },
  { name: "Niramai", founder: "Geetha Manjunath", website: "https://niramai.com", funding: "Series A", location: "Bengaluru" },
  { name: "CropIn", founder: "Krishna Kumar", website: "https://cropin.com", funding: "Series C", location: "Bengaluru" },
  { name: "Myelin Foundry", founder: "Gopichand Katragadda", website: "https://myelinfoundry.com", funding: "Series A", location: "Bengaluru" },
  { name: "HyperVerge", founder: "Kedar Kulkarni", website: "https://hyperverge.co", funding: "Series A", location: "Bengaluru" },
  { name: "Bhanzu", founder: "Neelakantha Bhanu", website: "https://bhanzu.com", funding: "Series A", location: "Hyderabad" },
  { name: "SuperOps.ai", founder: "Arvind Parthiban", website: "https://superops.ai", funding: "Series B", location: "Chennai" },
  { name: "Rocketlane", founder: "Srikrishnan Ganesan", website: "https://rocketlane.com", funding: "Series B", location: "Chennai" },
  { name: "Appsmith", founder: "Arpit Mohan", website: "https://appsmith.com", funding: "Series B", location: "Bengaluru" },
  { name: "Tartan AI", founder: "Meet Semlani", website: "https://tartanlabs.com", funding: "Seed", location: "Bengaluru" },
  { name: "FinBox", founder: "Rajat Deshpande", website: "https://finbox.in", funding: "Series A", location: "Bengaluru" },
  { name: "Credgenics", founder: "Rishabh Goel", website: "https://credgenics.com", funding: "Series B", location: "Noida" },
  { name: "Bureau.id", founder: "Ranjan R Reddy", website: "https://bureau.id", funding: "Series A", location: "Bengaluru" },
  { name: "Dozee", founder: "Mudit Dandwate", website: "https://dozee.health", funding: "Series A", location: "Bengaluru" },
  { name: "Tricog Health", founder: "Charit Bhograj", website: "https://tricog.com", funding: "Series B", location: "Bengaluru" },
  { name: "5C Network", founder: "Kalyan Sivasailam", website: "https://5cnetwork.com", funding: "Series A", location: "Bengaluru" },
  { name: "BrainSightAI", founder: "Laina Emmanuel", website: "https://brainsightai.com", funding: "Seed", location: "Bengaluru" },
  { name: "AgNext Technologies", founder: "Taranjeet Singh Bhamra", website: "https://agnext.com", funding: "Series A", location: "Chandigarh" },
  { name: "Fasal", founder: "Ananda Verma", website: "https://fasal.co", funding: "Series A", location: "Bengaluru" },
  { name: "Stellapps", founder: "Ranjith Mukundan", website: "https://stellapps.com", funding: "Series C", location: "Bengaluru" },
  { name: "DeHaat", founder: "Shashank Kumar", website: "https://agrevolution.in", funding: "Series E", location: "Patna / Gurgaon" },
  { name: "Wadhwani AI", founder: "Romesh Wadhwani", website: "https://wadhwaniai.org", funding: "Grant Funded", location: "Mumbai" },
  { name: "Klynk", founder: "Saurabh Sharma", website: "https://klynk.ai", funding: "Seed", location: "Bengaluru" },
  { name: "Conversational Labs", founder: "Aditya Roy", website: "https://convlabs.ai", funding: "Seed", location: "Hyderabad" },
  { name: "Aira Matrix", founder: "Chaithanya Krishna", website: "https://airamatrix.com", funding: "Series A", location: "Mumbai" },
  { name: "DheeYantra", founder: "Sreekumar K", website: "https://dheeyantra.com", funding: "Seed", location: "Bengaluru" },
  { name: "AryaX.ai", founder: "Vinay Kumar", website: "https://aryax.ai", funding: "Pre-Series A", location: "Mumbai" },
];

function buildScenario1Records(): AgentRecord[] {
  const records: AgentRecord[] = [];
  const primarySource = "https://tracxn.com/explore/Artificial-Intelligence-Startups-in-India";
  const newsSource = "https://inc42.com/reports/indian-ai-startups-2024";

  // 1. Add base 52 realistic startups
  for (const s of indianAiStartupNames) {
    records.push({
      values: {
        company_name: s.name,
        founder: s.founder,
        website: s.website,
        funding: s.funding,
        location: s.location,
        source_url: s.website,
      },
      rawValues: {
        company_name: s.name.toUpperCase(),
        funding: s.funding,
        _isDemoSimulated: true,
        _provenance: "DEMO_SCENARIO_1_SEEDED",
      },
      sourceUrls: [s.website, primarySource],
    });
  }

  // 2. Generate 50 additional realistic startups to hit 102 unique entities
  const cities = ["Bengaluru", "Hyderabad", "Delhi NCR", "Mumbai", "Pune", "Chennai", "Ahmedabad", "Noida", "Kolkata"];
  const stages = ["Seed", "Pre-Series A", "Series A", "Series B"];
  const distinctBrands = [
    "AadhaarAI", "VayuAI", "SamarthAI", "AgniAI", "ChanakyaAI", "BodhiAI", "PranaAI", "ShikshaAI", "DharmaAI", "KuberAI",
    "GarudaAI", "SurakshaAI", "SutraAI", "TejasAI", "AkashAI", "TrishulAI", "ChetakAI", "BrahmaAI", "IndusAI", "AryabhataAI",
    "VedicAI", "KritiAI", "MokshaAI", "NyayaAI", "SankhyaAI", "YogaAI", "RishiAI", "MitraAI", "SakhaAI", "GuruAI",
    "VidyaAI", "GyanAI", "DronaAI", "EkalavyaAI", "KarnaAI", "ArjunaAI", "BhimaAI", "NakulaAI", "SahadevaAI", "VyasaAI",
    "ValmikiAI", "KalidasaAI", "PaniniAI", "CharakaAI", "SushrutaAI", "VarahamihiraAI", "BhaskaraAI", "MadhavaAI", "PingalaAI", "KautilyaAI",
  ];

  for (let i = 0; i < distinctBrands.length; i++) {
    const name = distinctBrands[i]!;
    const slug = name.toLowerCase();
    const city = cities[i % cities.length]!;
    const stage = stages[i % stages.length]!;
    records.push({
      values: {
        company_name: name,
        founder: `Dr. Ramesh Gupta ${i + 1}`,
        website: `https://${slug}.in`,
        funding: stage,
        location: city,
        source_url: `https://${slug}.in`,
      },
      rawValues: {
        company_name: name.toUpperCase(),
        funding: stage,
        _isDemoSimulated: true,
        _provenance: "DEMO_SCENARIO_1_SEEDED",
      },
      sourceUrls: [`https://${slug}.in`, primarySource],
    });
  }

  // 3. Deliberate Duplicate 1: Sarvam AI with conflict on funding stage (Seed vs Series A)
  records.push({
    values: {
      company_name: "Sarvam AI",
      founder: "Vivek Raghavan",
      website: "https://sarvam.ai/",
      funding: "Seed", // Disagrees with Series A
      location: "Bengaluru",
      source_url: newsSource,
    },
    rawValues: {
      company_name: "Sarvam AI",
      funding: "Seed",
      _isDemoSimulated: true,
      _provenance: "DEMO_SCENARIO_1_DUPLICATE_CONFLICT",
    },
    sourceUrls: [newsSource],
  });

  // 4. Deliberate Duplicate 2: Krutrim duplicate
  records.push({
    values: {
      company_name: "Krutrim",
      founder: "Bhavish Aggarwal",
      website: "https://krutrim.ai/",
      funding: "Series A",
      location: "Bengaluru",
      source_url: primarySource,
    },
    rawValues: {
      company_name: "Krutrim AI Designs",
      _isDemoSimulated: true,
      _provenance: "DEMO_SCENARIO_1_DUPLICATE",
    },
    sourceUrls: [primarySource],
  });

  // 5. Deliberate Duplicate 3: Karya duplicate
  records.push({
    values: {
      company_name: "Karya",
      founder: "Manu Chopra",
      website: "https://karya.ai/",
      funding: "Seed",
      location: "Bengaluru",
      source_url: newsSource,
    },
    rawValues: {
      company_name: "Karya Inc",
      _isDemoSimulated: true,
      _provenance: "DEMO_SCENARIO_1_DUPLICATE",
    },
    sourceUrls: [newsSource],
  });

  // 6. Validation Issue entity: empty founder & invalid URL
  records.push({
    values: {
      company_name: "Incomplete AI Lab",
      founder: "",
      website: "not-a-valid-http-url",
      funding: "Pre-seed",
      location: "Bengaluru",
      source_url: primarySource,
    },
    rawValues: {
      company_name: "Incomplete AI Lab",
      _isDemoSimulated: true,
      _provenance: "DEMO_SCENARIO_1_VALIDATION_ERROR",
    },
    sourceUrls: [primarySource],
  });

  return records;
}

// ============================================================================
// SCENARIO 2: Software Engineering Jobs in India
// ============================================================================

const SCENARIO_2_PROMPT =
  "Find software engineering jobs in India and collect company, role, location, salary, application URL and source.";

const scenario2Sources: AgentSourceMetadata[] = [
  { url: "https://www.linkedin.com/jobs/india-software-engineer", canonicalUrl: "https://www.linkedin.com/jobs/india-software-engineer", domain: "linkedin.com", title: "[DEMO] LinkedIn India Software Engineering Jobs", snippet: "[SIMULATED PROVENANCE] Real-time listings for senior, lead, and staff engineering roles across Bengaluru, Hyderabad, and Remote.", sourceType: "search", retrievedAt: now, verifiedByTool: true },
  { url: "https://instahyre.com/jobs-software-engineer-india", canonicalUrl: "https://instahyre.com/jobs-software-engineer-india", domain: "instahyre.com", title: "[DEMO] Instahyre Tech Talent Marketplace", snippet: "[SIMULATED PROVENANCE] Curated tech roles with transparent compensation ranges at top tier tech unicorns.", sourceType: "search", retrievedAt: now, verifiedByTool: true },
  { url: "https://cutshort.io/jobs/software-engineer", canonicalUrl: "https://cutshort.io/jobs/software-engineer", domain: "cutshort.io", title: "[DEMO] Cutshort Developer Hiring", snippet: "[SIMULATED PROVENANCE] Fast-track engineering openings at high-growth Indian startups.", sourceType: "search", retrievedAt: now, verifiedByTool: true },
  { url: "https://careers.google.com/jobs/india", canonicalUrl: "https://careers.google.com/jobs/india", domain: "careers.google.com", title: "[DEMO] Google India Careers", snippet: "[SIMULATED PROVENANCE] Software engineer openings across Google Cloud and Search in Bengaluru.", sourceType: "scrape", retrievedAt: now, verifiedByTool: true },
  { url: "https://careers.microsoft.com/jobs/india", canonicalUrl: "https://careers.microsoft.com/jobs/india", domain: "careers.microsoft.com", title: "[DEMO] Microsoft India Careers", snippet: "[SIMULATED PROVENANCE] Senior engineering roles in Azure and Developer Division in Hyderabad.", sourceType: "scrape", retrievedAt: now, verifiedByTool: true },
  { url: "https://flipkartcareers.com/jobs", canonicalUrl: "https://flipkartcareers.com/jobs", domain: "flipkartcareers.com", title: "[DEMO] Flipkart Tech Careers", snippet: "[SIMULATED PROVENANCE] Backend and distributed systems roles at Flipkart India.", sourceType: "scrape", retrievedAt: now, verifiedByTool: true },
  { url: "https://broken-jobboard.example.com/404", canonicalUrl: "https://broken-jobboard.example.com/404", domain: "broken-jobboard.example.com", title: "[DEMO] Stale Job Board (404 Test)", snippet: "HTTP 404 Not Found", sourceType: "scrape", retrievedAt: now, verifiedByTool: false },
];

const jobsData = [
  { company: "Google India", role: "Software Engineer III (Backend)", location: "Bengaluru", salary: "₹38-52 LPA", appUrl: "https://careers.google.com/jobs/101", source: "Google Careers" },
  { company: "Microsoft India", role: "Senior Software Engineer (Azure)", location: "Hyderabad", salary: "₹42-56 LPA", appUrl: "https://careers.microsoft.com/jobs/201", source: "Microsoft Careers" },
  { company: "Amazon India", role: "Software Development Engineer II", location: "Bengaluru", salary: "₹34-46 LPA", appUrl: "https://amazon.jobs/jobs/301", source: "Amazon Jobs" },
  { company: "Flipkart", role: "SDE II (Distributed Systems)", location: "Bengaluru", salary: "₹28-38 LPA", appUrl: "https://flipkartcareers.com/jobs/401", source: "Flipkart Careers" },
  { company: "Razorpay", role: "Senior Backend Engineer (Payments)", location: "Bengaluru", salary: "₹32-44 LPA", appUrl: "https://razorpay.com/jobs/501", source: "LinkedIn" },
  { company: "Swiggy", role: "Lead Software Engineer (Logistics)", location: "Bengaluru", salary: "₹40-52 LPA", appUrl: "https://swiggy.com/careers/601", source: "Instahyre" },
  { company: "Zomato", role: "Frontend Engineer (React/Next)", location: "Gurgaon", salary: "₹24-34 LPA", appUrl: "https://zomato.com/careers/701", source: "Cutshort" },
  { company: "CRED", role: "Backend Engineer (Go/Distributed)", location: "Bengaluru", salary: "₹36-50 LPA", appUrl: "https://cred.club/careers/801", source: "LinkedIn" },
  { company: "Meesho", role: "Senior Software Engineer (Supply Chain)", location: "Bengaluru", salary: "₹32-44 LPA", appUrl: "https://meesho.io/careers/901", source: "Cutshort" },
  { company: "PhonePe", role: "Software Engineer (Platform)", location: "Bengaluru", salary: "₹26-36 LPA", appUrl: "https://phonepe.com/careers/1001", source: "PhonePe Careers" },
  { company: "Zerodha", role: "Full Stack Engineer (Python/Go)", location: "Bengaluru", salary: "₹25-38 LPA", appUrl: "https://zerodha.com/careers/1101", source: "Zerodha Portal" },
  { company: "Paytm", role: "Staff Engineer (Core Banking)", location: "Noida", salary: "₹32-45 LPA", appUrl: "https://paytm.com/careers/1201", source: "LinkedIn" },
  { company: "Postman", role: "Platform Engineer (API Tooling)", location: "Bengaluru", salary: "₹36-52 LPA", appUrl: "https://postman.com/careers/1301", source: "Instahyre" },
  { company: "BrowserStack", role: "Software Engineer (Cloud Devices)", location: "Mumbai", salary: "₹22-32 LPA", appUrl: "https://browserstack.com/careers/1401", source: "Cutshort" },
  { company: "Atlassian", role: "Software Engineer II (Jira Cloud)", location: "Bengaluru", salary: "₹38-54 LPA", appUrl: "https://atlassian.com/careers/1501", source: "LinkedIn" },
  { company: "Ola", role: "SDE II (Maps & Mobility)", location: "Bengaluru", salary: "₹25-36 LPA", appUrl: "https://olacabs.com/careers/1601", source: "Naukri" },
  { company: "Freshworks", role: "Senior Software Engineer (SaaS)", location: "Chennai", salary: "₹24-34 LPA", appUrl: "https://freshworks.com/careers/1701", source: "Freshworks Portal" },
  { company: "Zoho", role: "Software Developer (CRM Suite)", location: "Chennai", salary: "₹14-22 LPA", appUrl: "https://zoho.com/careers/1801", source: "Zoho Careers" },
  { company: "Urban Company", role: "Backend Lead (Marketplace)", location: "Gurgaon", salary: "₹34-48 LPA", appUrl: "https://urbancompany.com/careers/1901", source: "Instahyre" },
  { company: "Clevertap", role: "Data Engineer (Streaming Analytics)", location: "Mumbai", salary: "₹24-34 LPA", appUrl: "https://clevertap.com/careers/2001", source: "Cutshort" },
  { company: "Slice", role: "Android Engineer (Fintech)", location: "Bengaluru", salary: "₹28-40 LPA", appUrl: "https://sliceit.com/careers/2101", source: "LinkedIn" },
  { company: "Groww", role: "Infrastructure Engineer (Kubernetes)", location: "Bengaluru", salary: "₹30-42 LPA", appUrl: "https://groww.in/careers/2201", source: "Groww Portal" },
  { company: "Dream11", role: "Senior SDE (High Concurrency)", location: "Mumbai", salary: "₹36-52 LPA", appUrl: "https://dream11.com/careers/2301", source: "Instahyre" },
  { company: "Zepto", role: "Lead Backend Engineer (Dark Store Tech)", location: "Mumbai", salary: "₹38-50 LPA", appUrl: "https://zepto.com/careers/2401", source: "Cutshort" },
  { company: "InMobi", role: "Software Engineer II (AdTech)", location: "Bengaluru", salary: "₹26-38 LPA", appUrl: "https://inmobi.com/careers/2501", source: "InMobi Portal" },
  { company: "Upstox", role: "Senior Frontend Engineer (Trading UI)", location: "Mumbai", salary: "₹26-36 LPA", appUrl: "https://upstox.com/careers/2601", source: "Cutshort" },
  { company: "Zeta", role: "Platform Engineer (Omnichannel Banking)", location: "Bengaluru", salary: "₹30-42 LPA", appUrl: "https://zeta.tech/careers/2701", source: "LinkedIn" },
  { company: "Udaan", role: "SDE III (B2B E-commerce)", location: "Bengaluru", salary: "₹32-44 LPA", appUrl: "https://udaan.com/careers/2801", source: "Naukri" },
  { company: "HackerRank", role: "Full Stack Engineer (Developer Experience)", location: "Bengaluru", salary: "₹25-36 LPA", appUrl: "https://hackerrank.com/careers/2901", source: "Instahyre" },
  { company: "Juspay", role: "Functional Programmer (Haskell/Rust Payments)", location: "Bengaluru", salary: "₹22-35 LPA", appUrl: "https://juspay.in/careers/3001", source: "Juspay Careers" },
];

function buildScenario2Records(): AgentRecord[] {
  const records: AgentRecord[] = [];
  const primarySource = "https://www.linkedin.com/jobs/india-software-engineer";

  for (const j of jobsData) {
    records.push({
      values: {
        company: j.company,
        role: j.role,
        location: j.location,
        salary: j.salary,
        application_url: j.appUrl,
        source: j.source,
      },
      rawValues: {
        company: j.company.toUpperCase(),
        salary: j.salary,
        _isDemoSimulated: true,
        _provenance: "DEMO_SCENARIO_2_SEEDED",
      },
      sourceUrls: [j.appUrl, primarySource],
    });
  }

  // Duplicate 1: Google India duplicate with conflicting salary reported on a secondary portal
  records.push({
    values: {
      company: "Google India",
      role: "Software Engineer III (Backend)",
      location: "Bengaluru",
      salary: "₹42-58 LPA", // Disagrees with ₹38-52 LPA
      application_url: "https://careers.google.com/jobs/101",
      source: "Instahyre",
    },
    rawValues: {
      company: "Google India",
      salary: "₹42-58 LPA",
      _isDemoSimulated: true,
      _provenance: "DEMO_SCENARIO_2_DUPLICATE_CONFLICT",
    },
    sourceUrls: ["https://instahyre.com/jobs-software-engineer-india"],
  });

  // Duplicate 2: Microsoft India duplicate
  records.push({
    values: {
      company: "Microsoft India",
      role: "Senior Software Engineer (Azure)",
      location: "Hyderabad",
      salary: "₹42-56 LPA",
      application_url: "https://careers.microsoft.com/jobs/201",
      source: "LinkedIn",
    },
    rawValues: {
      company: "Microsoft India R&D",
      _isDemoSimulated: true,
      _provenance: "DEMO_SCENARIO_2_DUPLICATE",
    },
    sourceUrls: [primarySource],
  });

  return records;
}

// ============================================================================
// SCENARIO 3: Technology Sponsors for a College Hackathon
// ============================================================================

const SCENARIO_3_PROMPT =
  "Find potential technology sponsors for a college hackathon and collect company name, industry, website and contact page.";

const scenario3Sources: AgentSourceMetadata[] = [
  { url: "https://devfolio.co/hackathons", canonicalUrl: "https://devfolio.co/hackathons", domain: "devfolio.co", title: "[DEMO] Devfolio Sponsor Directory", snippet: "[SIMULATED PROVENANCE] Directory of active developer tool sponsors supporting student hackathons across India.", sourceType: "search", retrievedAt: now, verifiedByTool: true },
  { url: "https://mlh.io/sponsor", canonicalUrl: "https://mlh.io/sponsor", domain: "mlh.io", title: "[DEMO] Major League Hacking Sponsors", snippet: "[SIMULATED PROVENANCE] Global and regional technology companies sponsoring collegiate hackathons.", sourceType: "search", retrievedAt: now, verifiedByTool: true },
  { url: "https://github.com/education", canonicalUrl: "https://github.com/education", domain: "github.com", title: "[DEMO] GitHub Education Campus Program", snippet: "[SIMULATED PROVENANCE] Developer tools and hackathon sponsorship grants for student organizers.", sourceType: "scrape", retrievedAt: now, verifiedByTool: true },
  { url: "https://postman.com/student-program", canonicalUrl: "https://postman.com/student-program", domain: "postman.com", title: "[DEMO] Postman Student Community", snippet: "[SIMULATED PROVENANCE] API platform workshops, swags, and hackathon sponsorship tiers.", sourceType: "scrape", retrievedAt: now, verifiedByTool: true },
  { url: "https://polygon.technology/community", canonicalUrl: "https://polygon.technology/community", domain: "polygon.technology", title: "[DEMO] Polygon Village & Dev Grants", snippet: "[SIMULATED PROVENANCE] Web3 and blockchain bounties for university hackathons.", sourceType: "scrape", retrievedAt: now, verifiedByTool: true },
  { url: "https://broken-sponsor-directory.example.com/404", canonicalUrl: "https://broken-sponsor-directory.example.com/404", domain: "broken-sponsor-directory.example.com", title: "[DEMO] Deprecated Sponsor Portal (404 Test)", snippet: "Resource missing", sourceType: "scrape", retrievedAt: now, verifiedByTool: false },
];

const sponsorsData = [
  { company: "GitHub", industry: "Developer Tools & Version Control", website: "https://github.com", contactPage: "https://github.com/education" },
  { company: "Postman", industry: "API Platform & Testing", website: "https://postman.com", contactPage: "https://postman.com/student-program" },
  { company: "Devfolio", industry: "Hackathon Platform & Community", website: "https://devfolio.co", contactPage: "https://devfolio.co/organize" },
  { company: "MongoDB", industry: "Database & Cloud Data", website: "https://mongodb.com", contactPage: "https://mongodb.com/community/academic-program" },
  { company: "Cloudflare", industry: "Cloud Security & CDN", website: "https://cloudflare.com", contactPage: "https://cloudflare.com/contact" },
  { company: "DigitalOcean", industry: "Cloud Infrastructure", website: "https://digitalocean.com", contactPage: "https://digitalocean.com/community/pages/hatch" },
  { company: "JetBrains", industry: "IDE & Developer Productivity", website: "https://jetbrains.com", contactPage: "https://jetbrains.com/community/education" },
  { company: "Polygon", industry: "Web3 & Blockchain Infrastructure", website: "https://polygon.technology", contactPage: "https://polygon.technology/contact-us" },
  { company: "AWS", industry: "Cloud Computing & AI", website: "https://aws.amazon.com", contactPage: "https://aws.amazon.com/developer/community/students" },
  { company: "Google Cloud", industry: "Cloud Computing & Enterprise AI", website: "https://cloud.google.com", contactPage: "https://cloud.google.com/edu/students" },
  { company: "Microsoft Azure", industry: "Cloud & Developer Services", website: "https://azure.microsoft.com", contactPage: "https://azure.microsoft.com/en-us/community" },
  { company: "Twilio", industry: "Communications API & SMS", website: "https://twilio.com", contactPage: "https://twilio.com/en-us/company/community" },
  { company: "Redis", industry: "In-Memory Database & Cache", website: "https://redis.io", contactPage: "https://redis.io/community" },
  { company: "Stream", industry: "Chat & Activity Feeds API", website: "https://getstream.io", contactPage: "https://getstream.io/contact" },
  { company: "Algolia", industry: "Search & Discovery API", website: "https://algolia.com", contactPage: "https://algolia.com/contact" },
  { company: "Resend", industry: "Email Infrastructure API", website: "https://resend.com", contactPage: "https://resend.com/contact" },
  { company: "Appwrite", industry: "Backend-as-a-Service", website: "https://appwrite.io", contactPage: "https://appwrite.io/community" },
  { company: "Supabase", industry: "Open Source Backend & Postgres", website: "https://supabase.com", contactPage: "https://supabase.com/contact" },
  { company: "Vercel", industry: "Frontend Cloud & Deployment", website: "https://vercel.com", contactPage: "https://vercel.com/contact" },
  { company: "Auth0 by Okta", industry: "Identity & Authentication", website: "https://auth0.com", contactPage: "https://auth0.com/contact-us" },
  { company: "Hasura", industry: "GraphQL & Instant Data APIs", website: "https://hasura.io", contactPage: "https://hasura.io/contact-us" },
  { company: "Sentry", industry: "Application Monitoring & Error Tracking", website: "https://sentry.io", contactPage: "https://sentry.io/contact" },
  { company: "Docker", industry: "Containerization & Developer Tools", website: "https://docker.com", contactPage: "https://docker.com/community" },
  { company: "Netlify", industry: "Web Hosting & Serverless", website: "https://netlify.com", contactPage: "https://netlify.com/contact" },
  { company: "Elastic", industry: "Search & Observability", website: "https://elastic.co", contactPage: "https://elastic.co/contact" },
];

function buildScenario3Records(): AgentRecord[] {
  const records: AgentRecord[] = [];
  const primarySource = "https://devfolio.co/hackathons";

  for (const s of sponsorsData) {
    records.push({
      values: {
        company_name: s.company,
        industry: s.industry,
        website: s.website,
        contact_page: s.contactPage,
      },
      rawValues: {
        company_name: s.company.toUpperCase(),
        industry: s.industry,
        _isDemoSimulated: true,
        _provenance: "DEMO_SCENARIO_3_SEEDED",
      },
      sourceUrls: [s.contactPage, primarySource],
    });
  }

  // Duplicate 1: GitHub duplicate with slight industry description conflict
  records.push({
    values: {
      company_name: "GitHub",
      industry: "DevOps & Open Source Platform", // Disagrees with Developer Tools & Version Control
      website: "https://github.com/",
      contact_page: "https://github.com/education",
    },
    rawValues: {
      company_name: "GitHub Inc",
      _isDemoSimulated: true,
      _provenance: "DEMO_SCENARIO_3_DUPLICATE_CONFLICT",
    },
    sourceUrls: ["https://mlh.io/sponsor"],
  });

  // Duplicate 2: Postman duplicate
  records.push({
    values: {
      company_name: "Postman",
      industry: "API Platform & Testing",
      website: "https://postman.com/",
      contact_page: "https://postman.com/student-program",
    },
    rawValues: {
      company_name: "Postman API",
      _isDemoSimulated: true,
      _provenance: "DEMO_SCENARIO_3_DUPLICATE",
    },
    sourceUrls: [primarySource],
  });

  return records;
}

// ============================================================================
// Scenario Registry & Factory
// ============================================================================

export const DEMO_SCENARIO_1: DemoScenarioDefinition = {
  id: "scenario-1-indian-ai-startups",
  name: "Indian AI Startups (Post-2020)",
  scenarioNumber: 1,
  canonicalPrompt: SCENARIO_1_PROMPT,
  description: "Find 100 Indian AI startups founded after 2020 with founder, funding, location, and verified website.",
  match: (prompt: string) => {
    const lower = prompt.toLowerCase();
    return (
      (lower.includes("ai startup") || lower.includes("indian ai") || lower.includes("startups in india")) &&
      (lower.includes("2020") || lower.includes("founder") || lower.includes("funding"))
    );
  },
  requirement: {
    objective: "Find 100 AI startups in India founded after 2020 with company name, founder, website, funding and location",
    entityType: "Indian AI Startup",
    quantity: 100,
    geography: { places: ["India"], scope: "country", includeSubregions: true },
    timeRange: { field: "founded_year", after: "2020-01-01", before: null, on: null, expression: "founded after 2020" },
    filters: [{ field: "founded_year", operator: "gt", value: 2020 }],
    constraints: ["Headquartered in India", "Founded strictly after 2020", "Active company website required"],
    fields: [
      { key: "company_name", label: "Company Name", type: "string", description: "Registered or brand name of the startup" },
      { key: "founder", label: "Founder", type: "string", description: "Founder(s) or leadership team" },
      { key: "website", label: "Website", type: "url", description: "Official corporate website" },
      { key: "funding", label: "Funding", type: "string", description: "Latest venture round or capital raised" },
      { key: "location", label: "Location", type: "string", description: "Headquarters city in India" },
      { key: "source_url", label: "Source URL", type: "url", description: "Provenance verification source" },
    ],
    requiredFields: ["company_name", "founder", "website", "funding", "location"],
    optionalFields: ["source_url"],
    sourcePreferences: ["Tracxn", "Inc42", "YourStory", "Official Company Domains"],
    sourceRestrictions: ["No unverified blogs or scrapers"],
    deduplicationKeys: ["company_name"],
    validationRules: [
      { fieldKey: "company_name", rule: "REQUIRED", description: "Company name must not be blank", severity: "error" },
      { fieldKey: "website", rule: "URL", description: "Website must be a valid HTTP(S) URL", severity: "error" },
    ],
    outputFormat: "json",
    ambiguities: [],
    missingInformation: [],
    warnings: [],
  },
  plan: {
    objective: "Collect 100 Indian AI startups founded after 2020 with verified founders, funding, and locations",
    constraints: ["Headquartered in India", "Founded strictly after 2020"],
    sourcePolicy: {
      permittedSourceTypes: ["official_website", "business_directory", "news"],
      allowedDomains: [],
      preferredDomains: ["sarvam.ai", "karya.ai", "krutrim.ai", "tracxn.com", "inc42.com", "yourstory.com"],
      blockedDomains: ["spam-domain.com"],
      respectRobotsTxt: true,
      respectSiteTerms: true,
      allowAuthentication: false,
      allowCaptchaBypass: false,
      maxRequestsPerDomainPerMinute: 30,
      policyRationale: "Respect robots.txt and adhere to fair rate limits across startup directories.",
    },
    searchStrategy: {
      queries: [
        { query: "top Indian generative AI startups founded after 2020 directory", sourceType: "business_directory", rationale: "Discover candidate startup listings" },
        { query: "Indian AI startups funding rounds 2023 2024", sourceType: "news", rationale: "Extract verified funding stages" },
      ],
      desiredSourceCount: 20,
      maximumSourceCount: 40,
      selectionRationale: "Multi-source provenance triangulation across tech news and corporate registries",
    },
    steps: [
      { id: "search-ai-startups", type: "SEARCH", description: "Discover candidate Indian AI startup directories and portals", input: {}, configuration: {}, dependencies: [], retryPolicy: { maxAttempts: 2, backoff: "none", initialDelayMs: 0, multiplier: 1, maxDelayMs: 0, retryableErrors: ["TRANSIENT_NETWORK"] }, timeoutMs: 30_000, expectedOutput: "Candidate source URLs", status: "PENDING" },
      { id: "scrape-ai-startups", type: "SCRAPE", description: "Scrape company details, founders, and funding announcements", input: {}, configuration: {}, dependencies: ["search-ai-startups"], retryPolicy: { maxAttempts: 2, backoff: "none", initialDelayMs: 0, multiplier: 1, maxDelayMs: 0, retryableErrors: ["TRANSIENT_NETWORK"] }, timeoutMs: 30_000, expectedOutput: "Raw HTML & text snippets", status: "PENDING" },
      { id: "extract-ai-startups", type: "EXTRACT", description: "Extract structured company records with provenance", input: {}, configuration: {}, dependencies: ["scrape-ai-startups"], retryPolicy: { maxAttempts: 2, backoff: "none", initialDelayMs: 0, multiplier: 1, maxDelayMs: 0, retryableErrors: ["TRANSIENT_NETWORK"] }, timeoutMs: 30_000, expectedOutput: "Candidate structured records", status: "PENDING" },
      { id: "transform-ai-startups", type: "TRANSFORM", description: "Normalize company names, funding strings, and URLs", input: {}, configuration: {}, dependencies: ["extract-ai-startups"], retryPolicy: { maxAttempts: 1, backoff: "none", initialDelayMs: 0, multiplier: 1, maxDelayMs: 0, retryableErrors: [] }, timeoutMs: 15_000, expectedOutput: "Clean normalized records", status: "PENDING" },
      { id: "validate-ai-startups", type: "VALIDATE", description: "Apply domain validation rules and flag anomalies", input: {}, configuration: {}, dependencies: ["transform-ai-startups"], retryPolicy: { maxAttempts: 1, backoff: "none", initialDelayMs: 0, multiplier: 1, maxDelayMs: 0, retryableErrors: [] }, timeoutMs: 15_000, expectedOutput: "Validated records with issue tags", status: "PENDING" },
      { id: "dedupe-ai-startups", type: "DEDUPLICATE", description: "Deduplicate identical startups and preserve conflicting attributes", input: {}, configuration: {}, dependencies: ["validate-ai-startups"], retryPolicy: { maxAttempts: 1, backoff: "none", initialDelayMs: 0, multiplier: 1, maxDelayMs: 0, retryableErrors: [] }, timeoutMs: 15_000, expectedOutput: "Canonical unique entities with duplicate references", status: "PENDING" },
      { id: "save-ai-startups", type: "SAVE", description: "Persist dataset, columns, rows, and source evidence into relational database", input: {}, configuration: {}, dependencies: ["dedupe-ai-startups"], retryPolicy: { maxAttempts: 1, backoff: "none", initialDelayMs: 0, multiplier: 1, maxDelayMs: 0, retryableErrors: [] }, timeoutMs: 30_000, expectedOutput: "Persisted relational dataset", status: "PENDING" },
    ],
    extractionSchema: {
      type: "object",
      additionalProperties: false,
      required: ["company_name", "founder", "website", "funding", "location"],
      properties: {
        company_name: { type: "string", description: "Startup brand name" },
        founder: { type: "string", description: "Key founder(s)" },
        website: { type: "string", description: "Official website" },
        funding: { type: "string", description: "Venture funding round" },
        location: { type: "string", description: "HQ City" },
        source_url: { type: "string", description: "Source URL" },
      },
    },
    transformations: [
      { fieldKey: "website", operation: "NORMALIZE_URL", description: "Standardize domain and protocol formatting" },
    ],
    validationRules: [
      { fieldKey: "company_name", rule: "REQUIRED", severity: "ERROR", description: "Company name is required" },
      { fieldKey: "website", rule: "URL", severity: "ERROR", description: "Valid HTTP(S) URL required" },
    ],
    deduplicationRules: [
      { keys: ["company_name"], strategy: "NORMALIZED", confidenceThreshold: 0.95, ambiguousMatchAction: "KEEP_SEPARATE", rationale: "Deduplicate on normalized company name" },
    ],
    completionCriteria: {
      targetRecordCount: 100,
      minimumSources: 10,
      requiredFieldsPresent: ["company_name", "founder", "website", "funding", "location"],
      requireSourceEvidence: true,
      stopWhenTargetReached: true,
      allowPartialResults: true,
      completionDescription: "Successfully collected 100 Indian AI startups",
    },
    outputConfiguration: {
      format: "unspecified",
      expectedColumns: ["company_name", "founder", "website", "funding", "location", "source_url"],
      includeSourceEvidence: true,
    },
  },
  sources: scenario1Sources,
  records: buildScenario1Records(),
  expectedMetrics: {
    targetCount: 100,
    rawRecordCount: 106,
    validRecordCount: 102,
    duplicateCount: 3,
    conflictCount: 1,
    sourceCount: 18,
  },
};

export const DEMO_SCENARIO_2: DemoScenarioDefinition = {
  id: "scenario-2-software-engineering-jobs",
  name: "Software Engineering Jobs in India",
  scenarioNumber: 2,
  canonicalPrompt: SCENARIO_2_PROMPT,
  description: "Find software engineering jobs in India and collect company, role, location, salary, application URL, and source.",
  match: (prompt: string) => {
    const lower = prompt.toLowerCase();
    return (
      (lower.includes("job") || lower.includes("hiring") || lower.includes("opening") || lower.includes("internship")) &&
      (lower.includes("software") || lower.includes("engineer") || lower.includes("sde"))
    );
  },
  requirement: {
    objective: "Find software engineering jobs in India and collect company, role, location, salary, application URL and source",
    entityType: "Software Engineering Job",
    quantity: 30,
    geography: { places: ["India"], scope: "country", includeSubregions: true },
    timeRange: { field: null, after: null, before: null, on: null, expression: "active postings" },
    filters: [],
    constraints: ["Active tech postings in India", "Includes compensation range where available"],
    fields: [
      { key: "company", label: "Company", type: "string", description: "Hiring company name" },
      { key: "role", label: "Role", type: "string", description: "Designation / position title" },
      { key: "location", label: "Location", type: "string", description: "Work city or Remote" },
      { key: "salary", label: "Salary", type: "string", description: "Annual compensation range" },
      { key: "application_url", label: "Application URL", type: "url", description: "Direct application link" },
      { key: "source", label: "Source", type: "string", description: "Job board or portal name" },
    ],
    requiredFields: ["company", "role", "location", "salary", "application_url", "source"],
    optionalFields: [],
    sourcePreferences: ["LinkedIn", "Instahyre", "Cutshort", "Official Career Portals"],
    sourceRestrictions: ["No expired job links"],
    deduplicationKeys: ["company", "role"],
    validationRules: [
      { fieldKey: "company", rule: "REQUIRED", description: "Company is mandatory", severity: "error" },
      { fieldKey: "application_url", rule: "URL", description: "Application link must be valid URL", severity: "error" },
    ],
    outputFormat: "json",
    ambiguities: [],
    missingInformation: [],
    warnings: [],
  },
  plan: {
    objective: "Collect active software engineering jobs in India with roles, locations, salaries, and application links",
    constraints: ["Active tech postings in India"],
    sourcePolicy: {
      permittedSourceTypes: ["official_website", "business_directory", "news"],
      allowedDomains: [],
      preferredDomains: ["linkedin.com", "instahyre.com", "cutshort.io", "careers.google.com"],
      blockedDomains: ["spam-domain.com"],
      respectRobotsTxt: true,
      respectSiteTerms: true,
      allowAuthentication: false,
      allowCaptchaBypass: false,
      maxRequestsPerDomainPerMinute: 20,
      policyRationale: "Extract public developer postings respecting platform policies.",
    },
    searchStrategy: {
      queries: [
        { query: "Software engineer jobs Bengaluru Hyderabad LinkedIn", sourceType: "business_directory", rationale: "Locate major tech hub openings" },
        { query: "SDE II tech unicorn jobs India salary", sourceType: "business_directory", rationale: "Discover salary-disclosed engineering positions" },
      ],
      desiredSourceCount: 10,
      maximumSourceCount: 20,
      selectionRationale: "Coverage across top tech employers and developer hiring boards",
    },
    steps: [
      { id: "search-jobs", type: "SEARCH", description: "Search for tech job boards and career listings in India", input: {}, configuration: {}, dependencies: [], retryPolicy: { maxAttempts: 2, backoff: "none", initialDelayMs: 0, multiplier: 1, maxDelayMs: 0, retryableErrors: ["TRANSIENT_NETWORK"] }, timeoutMs: 30_000, expectedOutput: "Candidate job portals", status: "PENDING" },
      { id: "scrape-jobs", type: "SCRAPE", description: "Scrape job postings, compensation, and application URLs", input: {}, configuration: {}, dependencies: ["search-jobs"], retryPolicy: { maxAttempts: 2, backoff: "none", initialDelayMs: 0, multiplier: 1, maxDelayMs: 0, retryableErrors: ["TRANSIENT_NETWORK"] }, timeoutMs: 30_000, expectedOutput: "Raw HTML & text snippets", status: "PENDING" },
      { id: "extract-jobs", type: "EXTRACT", description: "Extract structured job records with provenance", input: {}, configuration: {}, dependencies: ["scrape-jobs"], retryPolicy: { maxAttempts: 2, backoff: "none", initialDelayMs: 0, multiplier: 1, maxDelayMs: 0, retryableErrors: ["TRANSIENT_NETWORK"] }, timeoutMs: 30_000, expectedOutput: "Candidate structured job records", status: "PENDING" },
      { id: "transform-jobs", type: "TRANSFORM", description: "Normalize salary formats and application URLs", input: {}, configuration: {}, dependencies: ["extract-jobs"], retryPolicy: { maxAttempts: 1, backoff: "none", initialDelayMs: 0, multiplier: 1, maxDelayMs: 0, retryableErrors: [] }, timeoutMs: 15_000, expectedOutput: "Clean normalized job records", status: "PENDING" },
      { id: "validate-jobs", type: "VALIDATE", description: "Validate URLs and verify mandatory fields", input: {}, configuration: {}, dependencies: ["transform-jobs"], retryPolicy: { maxAttempts: 1, backoff: "none", initialDelayMs: 0, multiplier: 1, maxDelayMs: 0, retryableErrors: [] }, timeoutMs: 15_000, expectedOutput: "Validated records", status: "PENDING" },
      { id: "dedupe-jobs", type: "DEDUPLICATE", description: "Deduplicate identical postings across job portals", input: {}, configuration: {}, dependencies: ["validate-jobs"], retryPolicy: { maxAttempts: 1, backoff: "none", initialDelayMs: 0, multiplier: 1, maxDelayMs: 0, retryableErrors: [] }, timeoutMs: 15_000, expectedOutput: "Unique job listings", status: "PENDING" },
      { id: "save-jobs", type: "SAVE", description: "Persist dataset and provenance into database", input: {}, configuration: {}, dependencies: ["dedupe-jobs"], retryPolicy: { maxAttempts: 1, backoff: "none", initialDelayMs: 0, multiplier: 1, maxDelayMs: 0, retryableErrors: [] }, timeoutMs: 30_000, expectedOutput: "Persisted dataset", status: "PENDING" },
    ],
    extractionSchema: {
      type: "object",
      additionalProperties: false,
      required: ["company", "role", "location", "salary", "application_url", "source"],
      properties: {
        company: { type: "string", description: "Hiring entity" },
        role: { type: "string", description: "Job title" },
        location: { type: "string", description: "Location" },
        salary: { type: "string", description: "Salary range" },
        application_url: { type: "string", description: "Application link" },
        source: { type: "string", description: "Job source" },
      },
    },
    transformations: [
      { fieldKey: "application_url", operation: "NORMALIZE_URL", description: "Standardize application URLs" },
    ],
    validationRules: [
      { fieldKey: "company", rule: "REQUIRED", severity: "ERROR", description: "Company is required" },
      { fieldKey: "application_url", rule: "URL", severity: "ERROR", description: "Application URL must be valid" },
    ],
    deduplicationRules: [
      { keys: ["company"], strategy: "NORMALIZED", confidenceThreshold: 0.95, ambiguousMatchAction: "KEEP_SEPARATE", rationale: "Deduplicate company postings" },
    ],
    completionCriteria: {
      targetRecordCount: 30,
      minimumSources: 5,
      requiredFieldsPresent: ["company", "role", "location", "salary", "application_url", "source"],
      requireSourceEvidence: true,
      stopWhenTargetReached: true,
      allowPartialResults: true,
      completionDescription: "Successfully collected 30 software engineering jobs",
    },
    outputConfiguration: {
      format: "unspecified",
      expectedColumns: ["company", "role", "location", "salary", "application_url", "source"],
      includeSourceEvidence: true,
    },
  },
  sources: scenario2Sources,
  records: buildScenario2Records(),
  expectedMetrics: {
    targetCount: 30,
    rawRecordCount: 32,
    validRecordCount: 30,
    duplicateCount: 2,
    conflictCount: 1,
    sourceCount: 6,
  },
};

export const DEMO_SCENARIO_3: DemoScenarioDefinition = {
  id: "scenario-3-hackathon-sponsors",
  name: "College Hackathon Technology Sponsors",
  scenarioNumber: 3,
  canonicalPrompt: SCENARIO_3_PROMPT,
  description: "Find potential technology sponsors for a college hackathon and collect company name, industry, website, and contact page.",
  match: (prompt: string) => {
    const lower = prompt.toLowerCase();
    return (
      (lower.includes("sponsor") || lower.includes("hackathon") || lower.includes("college") || lower.includes("university")) &&
      (lower.includes("technology") || lower.includes("company") || lower.includes("contact"))
    );
  },
  requirement: {
    objective: "Find potential technology sponsors for a college hackathon and collect company name, industry, website and contact page",
    entityType: "Technology Sponsor",
    quantity: 25,
    geography: { places: ["Global", "India"], scope: "global", includeSubregions: true },
    timeRange: { field: null, after: null, before: null, on: null, expression: null },
    filters: [],
    constraints: ["Active developer relations or student hackathon sponsorship program"],
    fields: [
      { key: "company_name", label: "Company Name", type: "string", description: "Sponsoring entity" },
      { key: "industry", label: "Industry", type: "string", description: "Primary technology domain" },
      { key: "website", label: "Website", type: "url", description: "Official corporate website" },
      { key: "contact_page", label: "Contact Page", type: "url", description: "Hackathon or sponsorship contact URL" },
    ],
    requiredFields: ["company_name", "industry", "website", "contact_page"],
    optionalFields: [],
    sourcePreferences: ["Devfolio Sponsors", "MLH Sponsors", "GitHub Education", "Postman Students"],
    sourceRestrictions: [],
    deduplicationKeys: ["company_name"],
    validationRules: [
      { fieldKey: "company_name", rule: "REQUIRED", description: "Company name is mandatory", severity: "error" },
      { fieldKey: "contact_page", rule: "URL", description: "Contact page must be a valid URL", severity: "error" },
    ],
    outputFormat: "json",
    ambiguities: [],
    missingInformation: [],
    warnings: [],
  },
  plan: {
    objective: "Collect technology companies sponsoring student hackathons with developer contact links",
    constraints: ["Active student hackathon sponsorship program"],
    sourcePolicy: {
      permittedSourceTypes: ["official_website", "business_directory", "news"],
      allowedDomains: [],
      preferredDomains: ["devfolio.co", "mlh.io", "github.com", "postman.com"],
      blockedDomains: ["spam-domain.com"],
      respectRobotsTxt: true,
      respectSiteTerms: true,
      allowAuthentication: false,
      allowCaptchaBypass: false,
      maxRequestsPerDomainPerMinute: 20,
      policyRationale: "Gather public DevRel and hackathon sponsorship pages.",
    },
    searchStrategy: {
      queries: [
        { query: "student hackathon sponsors developer tools Devfolio MLH", sourceType: "business_directory", rationale: "Identify companies active in collegiate events" },
        { query: "university hackathon sponsorship contact page", sourceType: "official_website", rationale: "Direct developer relations submission portals" },
      ],
      desiredSourceCount: 8,
      maximumSourceCount: 15,
      selectionRationale: "Focus on developer-first platforms with dedicated student grants",
    },
    steps: [
      { id: "search-sponsors", type: "SEARCH", description: "Search for tech sponsor directories and hackathon partners", input: {}, configuration: {}, dependencies: [], retryPolicy: { maxAttempts: 2, backoff: "none", initialDelayMs: 0, multiplier: 1, maxDelayMs: 0, retryableErrors: ["TRANSIENT_NETWORK"] }, timeoutMs: 30_000, expectedOutput: "Candidate sponsor sources", status: "PENDING" },
      { id: "scrape-sponsors", type: "SCRAPE", description: "Scrape company industries and contact portals", input: {}, configuration: {}, dependencies: ["search-sponsors"], retryPolicy: { maxAttempts: 2, backoff: "none", initialDelayMs: 0, multiplier: 1, maxDelayMs: 0, retryableErrors: ["TRANSIENT_NETWORK"] }, timeoutMs: 30_000, expectedOutput: "Raw HTML & text snippets", status: "PENDING" },
      { id: "extract-sponsors", type: "EXTRACT", description: "Extract structured sponsor records with contact links", input: {}, configuration: {}, dependencies: ["scrape-sponsors"], retryPolicy: { maxAttempts: 2, backoff: "none", initialDelayMs: 0, multiplier: 1, maxDelayMs: 0, retryableErrors: ["TRANSIENT_NETWORK"] }, timeoutMs: 30_000, expectedOutput: "Candidate structured sponsor records", status: "PENDING" },
      { id: "transform-sponsors", type: "TRANSFORM", description: "Normalize company websites and contact URLs", input: {}, configuration: {}, dependencies: ["extract-sponsors"], retryPolicy: { maxAttempts: 1, backoff: "none", initialDelayMs: 0, multiplier: 1, maxDelayMs: 0, retryableErrors: [] }, timeoutMs: 15_000, expectedOutput: "Clean normalized records", status: "PENDING" },
      { id: "validate-sponsors", type: "VALIDATE", description: "Validate contact links and required fields", input: {}, configuration: {}, dependencies: ["transform-sponsors"], retryPolicy: { maxAttempts: 1, backoff: "none", initialDelayMs: 0, multiplier: 1, maxDelayMs: 0, retryableErrors: [] }, timeoutMs: 15_000, expectedOutput: "Validated records", status: "PENDING" },
      { id: "dedupe-sponsors", type: "DEDUPLICATE", description: "Deduplicate sponsors and preserve contact discrepancies", input: {}, configuration: {}, dependencies: ["validate-sponsors"], retryPolicy: { maxAttempts: 1, backoff: "none", initialDelayMs: 0, multiplier: 1, maxDelayMs: 0, retryableErrors: [] }, timeoutMs: 15_000, expectedOutput: "Unique sponsors list", status: "PENDING" },
      { id: "save-sponsors", type: "SAVE", description: "Persist dataset and provenance into database", input: {}, configuration: {}, dependencies: ["dedupe-sponsors"], retryPolicy: { maxAttempts: 1, backoff: "none", initialDelayMs: 0, multiplier: 1, maxDelayMs: 0, retryableErrors: [] }, timeoutMs: 30_000, expectedOutput: "Persisted dataset", status: "PENDING" },
    ],
    extractionSchema: {
      type: "object",
      additionalProperties: false,
      required: ["company_name", "industry", "website", "contact_page"],
      properties: {
        company_name: { type: "string", description: "Company name" },
        industry: { type: "string", description: "Industry" },
        website: { type: "string", description: "Website URL" },
        contact_page: { type: "string", description: "Contact URL" },
      },
    },
    transformations: [
      { fieldKey: "website", operation: "NORMALIZE_URL", description: "Normalize company website" },
      { fieldKey: "contact_page", operation: "NORMALIZE_URL", description: "Normalize contact link" },
    ],
    validationRules: [
      { fieldKey: "company_name", rule: "REQUIRED", severity: "ERROR", description: "Company name is required" },
      { fieldKey: "contact_page", rule: "URL", severity: "ERROR", description: "Valid contact URL required" },
    ],
    deduplicationRules: [
      { keys: ["company_name"], strategy: "NORMALIZED", confidenceThreshold: 0.95, ambiguousMatchAction: "KEEP_SEPARATE", rationale: "Deduplicate sponsors by company name" },
    ],
    completionCriteria: {
      targetRecordCount: 25,
      minimumSources: 4,
      requiredFieldsPresent: ["company_name", "industry", "website", "contact_page"],
      requireSourceEvidence: true,
      stopWhenTargetReached: true,
      allowPartialResults: true,
      completionDescription: "Successfully collected 25 hackathon technology sponsors",
    },
    outputConfiguration: {
      format: "unspecified",
      expectedColumns: ["company_name", "industry", "website", "contact_page"],
      includeSourceEvidence: true,
    },
  },
  sources: scenario3Sources,
  records: buildScenario3Records(),
  expectedMetrics: {
    targetCount: 25,
    rawRecordCount: 27,
    validRecordCount: 25,
    duplicateCount: 2,
    conflictCount: 1,
    sourceCount: 5,
  },
};

export const ALL_DEMO_SCENARIOS = [DEMO_SCENARIO_1, DEMO_SCENARIO_2, DEMO_SCENARIO_3] as const;

import { createDynamicDemoScenario } from "./dynamic-scenario.generator.js";

export function resolveDemoScenario(prompt: string): DemoScenarioDefinition {
  for (const scenario of ALL_DEMO_SCENARIOS) {
    if (scenario.match(prompt)) return scenario;
  }
  // Instead of static Indian AI startups fallback, dynamically synthesize
  // prompt-matching requirements, sources, steps, and records for arbitrary user requests.
  return createDynamicDemoScenario(prompt);
}

