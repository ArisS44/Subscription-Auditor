from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    supabase_url: str
    supabase_anon_key: str
    supabase_service_role_key: str
    supabase_jwt_secret: str
    database_url: str
    groq_api_key: str = ""

    # LLM access is entirely environment-driven so switching provider/model is a
    # config change, not a code change. Provider selects the adapter; model and
    # key are passed through to it. Default is Gemini Flash (the Groq free tier's
    # per-minute token ceiling made real multi-user use impractical); Groq remains
    # a supported fallback adapter selectable via LLM_PROVIDER=groq. llm_api_key
    # falls back to the Groq key so an existing Groq deployment needs no new secret.
    # llm_base_url is an optional override; when empty the adapter uses the
    # provider's standard endpoint.
    #
    # The model is pinned to an explicit version, NOT a `-latest` alias. An alias
    # re-points whenever the provider ships a new generation, so the model behind
    # the product changes with no commit and no deploy — taking latency and
    # behaviour with it. That happened here: `gemini-flash-lite-latest` moved from
    # the 2.5 generation to gemini-3.5-flash-lite mid-session, and the 2.5 models
    # are now returning 404 on every call despite still being listed. A pinned
    # version means the eventual retirement is a loud, schedulable failure instead
    # of a silent drift. Re-benchmark and bump deliberately when that happens.
    llm_provider: str = "gemini"
    llm_model: str = "gemini-3.1-flash-lite"
    llm_api_key: str = ""
    llm_base_url: str = ""
    vapid_private_key: str = ""
    vapid_public_key: str = ""
    vapid_subject: str = ""

    # Shared secret authenticating the external scheduler's ping. There is no
    # user and no JWT behind that request, so this token is the only thing in
    # front of a publicly routable endpoint - it is compared in constant time
    # (see app/security/compare.py). The empty default keeps local dev and the
    # test suite runnable without it; the endpoint that consumes it must fail
    # closed when it is unset rather than treating "no token configured" as
    # "no token required".
    job_token: str = ""
    # How long (seconds) the push service holds an undeliverable message before
    # discarding it. pywebpush defaults to 0 = "deliver now or drop", which loses
    # every reminder for a device that is asleep/offline at send time. A renewal
    # reminder is date-anchored, so it should survive until the user's device next
    # comes online within the lead window — 72h covers a closed laptop over a
    # weekend and comfortably spans the default 3-day lead. Environment-tunable.
    push_ttl_seconds: int = 259200
    # Upper bound on subscriptions processed per run-due invocation. The endpoint
    # is externally triggerable, so its work must be bounded rather than an
    # unbounded scan; a run that hits the cap makes progress and the next run
    # picks up the rest (ordering is deterministic).
    reminder_job_batch_size: int = 100
    applicationinsights_connection_string: str = ""
    env: str = "development"
    db_pool_min_size: int = 1
    db_pool_max_size: int = 10
    auth_rate_limit_per_minute: int = 20

    # Chat engine caps (all tunable from env). Velocity is a per-user post-auth
    # sliding window; the daily caps are DB-backed via llm_usage so they're
    # correct across replicas. The global ceiling protects the shared LLM budget.
    chat_user_per_minute: int = 30
    chat_user_daily_cap: int = 200
    chat_global_daily_cap: int = 5000
    # Sliding history window replayed to the model, and the per-turn tool-call
    # iteration ceiling that stops a runaway loop.
    chat_history_window: int = 20
    chat_max_tool_iterations: int = 5
    cors_allow_origins: str = "http://localhost:5173,http://localhost:5174,http://localhost:5175"

    @property
    def cors_allow_origins_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_allow_origins.split(",") if origin.strip()]

    @property
    def effective_llm_api_key(self) -> str:
        """The key the LLM adapter authenticates with: an explicit LLM_API_KEY
        wins, otherwise fall back to the pre-existing GROQ key so a Groq
        deployment works without setting a second secret."""
        return self.llm_api_key or self.groq_api_key


settings = Settings()  # type: ignore[call-arg]
