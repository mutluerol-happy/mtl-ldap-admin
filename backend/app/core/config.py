# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Mutlu Erol
"""
MTL LDAP Admin — Merkezi Yapılandırma

Tüm yapılandırma /etc/mtl/mtl-ldap-admin.env (master) veya
/etc/mtl/mtl-ldap.env (slave) dosyalarından okunur.

Profile'a göre (MASTER/SLAVE) bazı alanlar zorunlu değildir.
"""

from __future__ import annotations

from enum import Enum
from functools import lru_cache
from pathlib import Path
from typing import Optional

from pydantic import Field, SecretStr, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class NodeProfile(str, Enum):
    """Sunucu profili: MASTER (admin console) veya SLAVE (parola reset portali)."""

    MASTER = "MASTER"
    SLAVE = "SLAVE"


class Settings(BaseSettings):
    """
    Uygulama yapılandırması.

    Ortam değişkenleri MTL_ önekiyle okunur. Örnek:
      MTL_PROFILE=MASTER
      MTL_LDAP_URL=ldaps://127.0.0.1:636
    """

    model_config = SettingsConfigDict(
        env_prefix="MTL_",
        env_file=None,  # systemd EnvironmentFile= ile yüklenir
        case_sensitive=False,
        extra="ignore",
    )

    # === Genel ===
    node_id: str = Field(..., description="Bu sunucunun kısa adı (örn. mtl-master-01)")
    profile: NodeProfile = Field(..., description="MASTER veya SLAVE")
    secret_key: SecretStr = Field(..., description="JWT imzalama anahtarı (64+ char)")
    fernet_key: SecretStr = Field(..., description="Symmetric encryption (mtlMfaSecret)")

    # === HTTP ===
    listen_host: str = Field("127.0.0.1", description="Backend bind adresi")
    listen_port: int = Field(8000, ge=1, le=65535)
    api_prefix: str = Field("/api/v1", description="API path prefix")

    # === Veritabanı (asyncpg URL) ===
    db_url: str = Field(..., description="postgresql+asyncpg://user:pass@host:port/db")
    db_pool_size: int = Field(10, ge=1, le=100)
    db_max_overflow: int = Field(20, ge=0, le=100)
    db_pool_timeout: int = Field(30, ge=1)
    db_echo: bool = Field(False)

    # === Redis ===
    redis_url: str = Field(..., description="redis://:password@host:port/db")
    redis_max_connections: int = Field(20, ge=1, le=200)

    # === LDAP ===
    ldap_url: str = Field(..., description="Birincil LDAP URL (master için kendisi, slave için master)")
    ldap_read_url: Optional[str] = Field(None, description="Sadece-okuma LDAP URL (slave için kendisi)")
    ldap_bind_dn: str = Field(..., description="cn=admin,dc=...")
    ldap_bind_password: SecretStr = Field(..., description="LDAP admin parolası")
    ldap_replicator_dn: Optional[str] = Field(
        None, description="cn=replicator,dc=... (cluster genelinde AYNI; contextCSN okuma)"
    )
    ldap_replicator_password: Optional[SecretStr] = Field(
        None, description="Replicator parolasi (master+slave AYNI)"
    )
    ldap_base_dn: str = Field(..., description="dc=mtl,dc=local")
    ldap_ca_path: Path = Field(Path("/etc/mtl/ssl/mtl-ca.pem"))
    ldap_tls_verify: bool = Field(True)
    ldap_tls_hostname: Optional[str] = Field(
        None,
        description="LDAP TLS sertifika hostname override (IP'ye bağlanırken cert validation için)",
    )
    ldap_pool_size: int = Field(5, ge=1, le=50)
    ldap_connect_timeout: int = Field(10, ge=1)
    ldap_receive_timeout: int = Field(30, ge=1)

    # === Cluster (Sync Grid) ===
    master_url: Optional[str] = Field(None, description="Slave için master HTTPS URL")
    cluster_secret: SecretStr = Field(..., description="Master+slave AYNI olmalı")
    cluster_sync_interval: int = Field(60, ge=10, description="Saniye")

    # === Bootstrap admin (sadece master) ===
    bootstrap_admin_username: Optional[str] = Field("happy")
    bootstrap_admin_password: Optional[SecretStr] = Field(None)
    bootstrap_admin_email: Optional[str] = Field(None)

    # === E-mail/SMS (parola reset için, opsiyonel) ===
    smtp_host: Optional[str] = Field(None)
    smtp_port: int = Field(587)
    smtp_user: Optional[str] = Field(None)
    smtp_password: Optional[SecretStr] = Field(None)
    smtp_from: Optional[str] = Field(None)
    smtp_use_tls: bool = Field(True)

    sms_provider_url: Optional[str] = Field(None)
    sms_provider_token: Optional[SecretStr] = Field(None)

    # === Shield / Sertifika (Tur 14 — sadece master) ===
    ssl_dir: Path = Field(Path("/etc/mtl/ssl"), description="TLS dosya dizini")
    cert_staging_dir: Path = Field(Path("/etc/mtl/ssl/staging"), description="Aktivasyon staging")
    cert_apply_helper: Path = Field(Path("/opt/mtl/bin/mtl-cert-apply"), description="Ayrıcalıklı helper")
    ldaps_host: str = Field("127.0.0.1", description="Canlı LDAPS doğrulama host")
    ldaps_port: int = Field(636, ge=1, le=65535)
    https_port: int = Field(443, ge=1, le=65535)

    # === Geliştirme ===
    debug: bool = Field(False)
    log_level: str = Field("INFO")
    log_format: str = Field("json", description="json veya text")

    # === CORS (production'da kısıtlı) ===
    cors_origins: list[str] = Field(default_factory=list)

    @field_validator("ldap_ca_path")
    @classmethod
    def _ca_path_exists(cls, v: Path) -> Path:
        if not v.exists():
            # Sadece uyarı — bazı testlerde dosya olmayabilir
            import warnings
            warnings.warn(f"LDAP CA path bulunamadı: {v}", stacklevel=2)
        return v

    @field_validator("log_format")
    @classmethod
    def _log_format_valid(cls, v: str) -> str:
        if v not in ("json", "text"):
            raise ValueError("log_format 'json' veya 'text' olmalı")
        return v

    @property
    def is_master(self) -> bool:
        return self.profile == NodeProfile.MASTER

    @property
    def is_slave(self) -> bool:
        return self.profile == NodeProfile.SLAVE

    @property
    def is_production(self) -> bool:
        """Debug=False ise production sayılır (request_id sızdırmama vs.)."""
        return not self.debug

    @property
    def ldap_search_url(self) -> str:
        """
        Sadece-okuma sorgu URL'i.
        Slave kendi local LDAP'ini okur (replikasyon ile gelen veri).
        Master kendi LDAP'ini okur.
        """
        return self.ldap_read_url or self.ldap_url


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """
    Singleton settings cache.

    İlk çağrıda env'den okur, sonraki çağrılarda cache'den döner.
    Test'lerde get_settings.cache_clear() ile sıfırlanabilir.
    """
    return Settings()
