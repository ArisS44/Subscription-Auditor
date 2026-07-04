from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    supabase_url: str
    supabase_anon_key: str
    supabase_service_role_key: str
    supabase_jwt_secret: str
    database_url: str
    groq_api_key: str = ""
    vapid_private_key: str = ""
    vapid_public_key: str = ""
    vapid_subject: str = ""
    applicationinsights_connection_string: str = ""
    env: str = "development"
    db_pool_min_size: int = 1
    db_pool_max_size: int = 10
    auth_rate_limit_per_minute: int = 20


settings = Settings()  # type: ignore[call-arg]
