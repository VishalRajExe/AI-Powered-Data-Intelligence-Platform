from utils.get_llm import get_llm

def run_result_aggregator_tool(relevant_chunks, query, query_analysis):
    """
    This function aggregates the results from the content analysis and returns a summary.
    """
    llm = get_llm()
    system_content = (
        "You are an AI research assistant. Your task is to synthesize information and produce a coherent summary. "
        "Follow these guidelines:\n"
        "1. Combine information from multiple context chunks.\n"
        "2. Identify and resolve any contradictory information.\n"
        "3. Organize the information into a clear, logical structure.\n"
        "4. Generate a concise summary that directly answers the user's original query.\n"
        "5. Cite sources inline using the provided URLs." 
        f"6. Adhere to the user's intent: {query_analysis.get('intent', 'research')} and deliver the type of information requested: {query_analysis.get('information_type', 'research')}.\n"
        "7. If there is conflicting information across the sources (e.g., different values or opinions), identify the contradictions, indicate the range of values or perspectives, and provide the most likely correct answer based on the frequency or reliability of the sources. Include inline citations to the sources (e.g., [Source 1]) so users can trace the information\n"
        "8. When you display any collection of facts or figures in a table, use a proper Markdown table. Make sure the number of pipes matches your columns."
         "For example:\n\n"
  "| Rank | Title   | Gross (₹crore) | Sources |\n"
  "|------|---------|----------------|---------|\n"
  "| 1    | XYZ |        783–807 | Wikipedia, Enigmatic Horizon |\n\n"
    )

    context_text = "\n\n".join(
        f"Source: {chunk.metadata['source']}\n{chunk.page_content}" 
        for chunk in relevant_chunks
    )

    user_prompt = (
        "Below are excerpts from web sources. Use them in conjunction with the analysis context to answer the question.\n\n"
        f"Context:\n{context_text}\n\nQuestion: {query}\n"
        "Please include relevant facts, figures, and data in tabular format where applicable."
    )

    response = llm.chat.completions.create(messages=[{"role": "system", "content": system_content},{"role": "user", "content": user_prompt}], model='gpt-4o-mini-2')
    print('Final Response from LLM', response)
    answer = response.choices[0].message.content
    sources = list({c.metadata['source'] for c in relevant_chunks})
    return answer, sources