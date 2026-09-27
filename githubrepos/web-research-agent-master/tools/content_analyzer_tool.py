import os
from langchain.schema import Document
from langchain.vectorstores import Chroma
from langchain.text_splitter import RecursiveCharacterTextSplitter
from utils.logging import setup_logger

logger = setup_logger("content_analyzer")
def run_content_analyzer_tool(docs, embeddings, query_analysis, query):
    text_splitter = RecursiveCharacterTextSplitter(
        chunk_size=1000,
        chunk_overlap=50,
        length_function=len
    )

    documents = []
    for raw in docs:
        doc = Document(page_content=raw["content"], metadata={"source": raw["url"]})

        # split into chunks
        for chunk in text_splitter.split_documents([doc]):
            documents.append(chunk)

    logger.info(f"Documents created #{len(documents)}")
    vectorstore = Chroma.from_documents(
        documents=documents,
        embedding=embeddings,
    )

    print("Vectorstore created", vectorstore)
    retriever = vectorstore.as_retriever(search_kwargs={"k": 5})
    relevant_chunks = retriever.get_relevant_documents(query_analysis.get("search_strategy", query))
    return relevant_chunks