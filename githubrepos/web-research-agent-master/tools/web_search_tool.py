
import os
from langchain.tools import Tool
from langchain_google_community import GoogleSearchAPIWrapper

def get_google_search_tool() -> Tool:
    google = GoogleSearchAPIWrapper(
        google_api_key= os.getenv("GOOGLE_SEARCH_API_KEY"),
        google_cse_id=os.getenv("GOOGLE_CSE_ID"),
    )
    return Tool(
        name="google_search",
        func=google.results,
        description="Use this tool to get search results from Google"
    )
