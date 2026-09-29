"""Source curation: what to search for, which results are worth a fetch, and how to tell
them apart.

Adapted from `web-research-agent-master` (`utils/get_relevant_urls.py`,
`utils/web_scraper.py`, `tools/web_scraper_tool.py`, `tools/result_aggregator_tool.py`) with
three substitutions that matter:

* **No embeddings.** That repo scores relevance by cosine-similating the query against
  snippet embeddings from Azure OpenAI (`get_relevant_urls.py:7-12`). This service has one AI
  provider, Gemini, and one web engine, Firecrawl; adding a second provider purely to rank
  search results would be a second system for the same job. Relevance here is **lexical** and
  deterministic — see `relevance.py` for exactly what it can and cannot tell.
* **One search system.** Nothing here issues a web request. It ranks, filters and dedupes the
  results Firecrawl already returned, and gates a URL before Firecrawl is asked for it.
* **Refusals are reported.** That repo `continue`s past a blocked or failed URL with a log
  line (`web_scraper_tool.py:10,22`), so the caller cannot tell "no such source" from "we
  never looked". Every drop here carries a reason that reaches the run's metadata.
"""
