from utils.logging import setup_logger
from utils.analyze_query import analyze_query
from schemas import ResearchRequest, ResearchResponse
from tools.web_search_tool import get_google_search_tool
from tools.content_analyzer_tool import run_content_analyzer_tool
from tools.web_scraper_tool import run_web_scraper_tool
from tools.result_aggregator_tool import run_result_aggregator_tool
from fastapi import FastAPI, Request, Body
from fastapi.responses import JSONResponse
from starlette.middleware.cors import CORSMiddleware
import uvicorn
from utils.get_embeddings import get_embeddings
from utils.get_relevant_urls import get_relevant_urls
import os

from dotenv import load_dotenv
load_dotenv()

logger = setup_logger("web-research-agent")

app = FastAPI(title="Web Research Agent")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    logger.error(f"Unhandled error occurred during request: {request.url} - {exc}", exc_info=True)
    return JSONResponse(
        status_code=500,
        content={"detail": "An unexpected error occurred. Please try again later."}
    )

@app.get("/")
async def health_check():
    return {"status": "ok"}

@app.post("/execute-research", response_model=ResearchResponse)
async def execute_research(payload: ResearchRequest = Body(...)):
    query = payload.query

    # query analysis
    query_analysis = analyze_query(query)
    if query_analysis.get("intent") == "invalid":
        return {
            "query": query,
            "result": {
                "content": query_analysis.get("reason", "Invalid query"),
                "sources": []
            }
        }
    
    logger.info(f"Query analysis: {query_analysis}")
    subqueries = query_analysis.get("subqueries", [query])

    # web search
    google_search_tool = get_google_search_tool()

    search_results = []
    for sq in subqueries:
        results = google_search_tool.func(sq, num_results=10)
        for r in results:
            snippet = r.get("snippet", r.get("title", ""))
            search_results.append({"url": r["link"], "snippet": snippet, "subquery": sq})
     # logger.info(f"Google search results: {search_results}")
    logger.info(f"Collected {len(search_results)} search results")
    
    embeddings = get_embeddings()
    # get relevant URLs
    M = 10
    selected_urls = get_relevant_urls(query, embeddings, search_results, M)
    logger.info(f"Selected top {M} URLs: {selected_urls}")

    # scraping
    docs = await run_web_scraper_tool(selected_urls)
    logger.info(f"Scraped {len(docs)} pages")

    # relevant content from content analysis
    relevant_chunks = run_content_analyzer_tool(docs, embeddings, query_analysis, query)
    logger.info(f'relevant chunks {len(relevant_chunks)}')

    answer, sources = run_result_aggregator_tool(relevant_chunks, query, query_analysis)
    
    return {
        "query": query,
        "result": {"content": answer, "sources": sources }
    }

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=os.getenv('PORT', 8000))
