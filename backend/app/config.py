from functools import lru_cache

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    port: int = 8000

    database_url: str = "sqlite:///./app.db"

    @field_validator("database_url", mode="after")
    @classmethod
    def normalize_database_url(cls, v: str) -> str:
        if v.startswith("postgres://"):
            return v.replace("postgres://", "postgresql://", 1)
        return v

    # Logins moved from Supabase Auth to Neon Auth (managed Better Auth) on 2026-09-05,
    # when the Supabase project was shut down. Nothing Supabase remains — an old .env
    # carrying SUPABASE_* keys still loads, since unknown keys are ignored (extra above).
    #
    # The auth instance's base URL, e.g. https://<endpoint>.neonauth.<region>.aws.neon.tech/<db>/auth
    neon_auth_base_url: str = ""
    # Defaults to <base>/.well-known/jwks.json when left blank.
    neon_auth_jwks_url: str = ""

    # Powers the retail chatbot (app/services/chat_agent.py). Left blank, the chat
    # endpoint responds with a clear "not configured" error instead of failing deep
    # inside the OpenAI SDK.
    openai_api_key: str = ""
    openai_chat_model: str = "gpt-4o-mini"
    # DeepSeek speaks the same API, so it is a drop-in alternative (see
    # app/retail/services/chat/llm.py). It is used when its key is set; CHAT_PROVIDER
    # ("openai" or "deepseek") forces one when both keys are present.
    deepseek_api_key: str = ""
    deepseek_api_url: str = "https://api.deepseek.com"
    deepseek_chat_model: str = "deepseek-chat"
    chat_provider: str = ""
    # What one million tokens cost, in the provider's own currency (see its price page). Only
    # used to show an estimated cost on the assistant usage page; left at 0 it shows tokens only.
    chat_price_input_per_million: float = 0
    chat_price_output_per_million: float = 0
    # Input the provider served from its cache is cheaper (DeepSeek calls it a cache hit). Left at 0
    # it is billed at the normal input price.
    chat_price_cached_input_per_million: float = 0

    # Meaning-based search over the assistant's knowledge (app/retail/services/chat/embeddings.py).
    # Cloudflare Workers AI has a free daily allowance and the account is the one R2 already uses,
    # so CLOUDFLARE_ACCOUNT_ID may be left blank to reuse R2_ACCOUNT_ID. Without a token, search
    # falls back to keywords only — the assistant still works.
    cloudflare_ai_api_token: str = ""
    cloudflare_account_id: str = ""
    embedding_model: str = "@cf/baai/bge-m3"

    # How the assistant picks and uses its tools (app/retail/services/chat/routing.py, planning.py).
    # Both are off until the evaluation shows they help: ASSISTANT_TOOL_ROUTING shows the model a
    # shortlist of the tools that fit the question instead of all of them; ASSISTANT_PLANNING writes a
    # short plan first for a question that asks why, compares, or holds several questions.
    assistant_tool_routing: bool = True
    assistant_planning: bool = True

    # Cloudflare R2 Object Storage settings
    r2_account_id: str = ""
    r2_access_key_id: str = ""
    r2_secret_access_key: str = ""
    r2_bucket: str = "branchwise"

    # Restrict CORS to known origins (local dev, Electron, and web deployments)
    cors_origins: list[str] = [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:80",
        "http://127.0.0.1:80",
        "http://localhost",
        "http://127.0.0.1",
        "http://localhost:8000",
        "http://127.0.0.1:8000",
        # A packaged Electron renderer loaded with BrowserWindow.loadFile() sends
        # requests with the opaque `null` origin. Keep this explicit so the desktop
        # build can reach the local/remote API without weakening CORS globally.
        "null",
        "https://branchwise-app2.vercel.app",
        "https://branchwise-demo.vercel.app",
        "https://branchwise-demo-backend-ma74.onrender.com",
        "app://-",
    ]


@lru_cache
def get_settings() -> Settings:
    return Settings()
