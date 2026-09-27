import os
import json
from typing import Dict
from langchain.schema import HumanMessage
from utils.get_llm import get_llm
from utils.logging import setup_logger

logger = setup_logger("analyze_query")
def analyze_query(query: str) -> Dict:
    """
    Analyze the query using Azure OpenAI to understand intent, components, and information type.
    """
    # also add to prompt to return intent as harmful if it is something which should not be searched
    # or is not allowed to be searched
    prompt = f"""
    You are a query analysis tool. Given a research query, perform the following:
    1. Identify the intent behind the query (e.g., factual, exploratory, news, opinion, historical data).
    2. Break down the query into subqueries if it is complex (comma-separated list).
    3. Identify the type of information needed (facts, opinions, recent news, historical data).
    4. Formulate an effective search strategy based on the query type.
    5. If the query is nonsensical, irrelevant, or harmful, classify the intent as "invalid" and provide an appropriate reason.

    Respond with a JSON object in the following format:
    {{
        "intent": "<intent>",
        "subqueries": ["<subquery1>", "<subquery2>", ...],
        "information_type": "<information_type>",
        "search_strategy": "<search_strategy>"
        "reason": "<reason>"  # Include this field only if the intent is "invalid"
    }}

    Query: "{query}"
    """
    try:
        llm_client = get_llm()
        response = llm_client.chat.completions.create(messages=[{
            "role": "user",
            "content": prompt
        }], model='gpt-4o-mini-2')
        logger.info(f"LLM response: {response}")
        result = response.choices[0].message.content
        logger.info(f"Query analysis result: {result}")
        return json.loads(result)
    except Exception as e:
        print(f"Error during query analysis: {e}")
        return {
            "intent": "unknown",
            "subqueries": [query],
            "information_type": "unknown",
            "search_strategy": "Perform a general search."
        }