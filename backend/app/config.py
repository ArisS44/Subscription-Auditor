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
    # key are passed through to it. llm_api_key defaults to the Groq key so an
    # existing GROQ deployment needs no new secret. llm_base_url is an optional
    # override; when empty the adapter uses the provider's standard endpoint.
    llm_provider: str = "groq"
    llm_model: str = "llama-3.3-70b-versatile"
    llm_api_key: str = ""
    llm_base_url: str = ""
    vapid_private_key: str = ""
    vapid_public_key: str = ""
    vapid_subject: str = ""
    applicationinsights_connection_string: str = ""
    env: str = "development"
    db_pool_min_size: int = 1
    db_pool_max_size: int = 10
    auth_rate_limit_per_minute: int = 20
    cors_allow_origins: str = "http://localhost:5173"

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
