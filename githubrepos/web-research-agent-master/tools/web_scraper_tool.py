from utils.web_scraper import fetch_page, parse_html, allowed_to_scrape
from utils.logging import setup_logger

logger = setup_logger("web_scraper_tool")

async def run_web_scraper_tool(urls):
    docs = []
    for url in urls:
        if not await allowed_to_scrape(url):
            logger.warning(f"Blocked by robots.txt: {url}")
            continue
        try:
            
            html = await fetch_page(url, 1)
            text = parse_html(html)
            # TODO: future scope
            # if not moderate_content(text):
            #     logger.warning(f"Content flagged: {url}")
            #     continue
            docs.append({"url": url, "content": text})
        except Exception as e:
            logger.warning(f"Failed to scrape {url}: {e}")
    return docs