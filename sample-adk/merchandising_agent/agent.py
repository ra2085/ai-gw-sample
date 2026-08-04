import os
from google.adk.agents import Agent
from google.adk.models.apigee_llm import ApigeeLlm
from google.adk.tools.mcp_tool.mcp_toolset import McpToolset, StreamableHTTPConnectionParams
from google.adk.integrations.agent_identity import GcpAuthProvider, GcpAuthProviderScheme
from google.adk.tools.authenticated_function_tool import AuthenticatedFunctionTool

APIGEE_HOST = os.environ.get("APIGEE_HOST")
AI_GATEWAY_PATH = "/ai-gateway"

## 1. Set LLM GW
model = ApigeeLlm(
    model="apigee/gemini-3.1-flash-lite",
    proxy_url=f"https://{APIGEE_HOST}{AI_GATEWAY_PATH}",
)

system_instruction = (
    "You are a strict but helpful retail operations coordinator. "
    "Your goal is to help regional retail managers verify display compliance, analyze performance, and coordinate marketing materials.\n"
)

root_agent = Agent(
    model=model,
    name="merchandising_assistant_agent",
    instruction=system_instruction,
)

if __name__ == "__main__":
    print(f"Agent created: {root_agent.name}")
