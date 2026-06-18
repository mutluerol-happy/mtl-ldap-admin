# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Mutlu Erol
"""
LDAP client wrapper (ldap3 üzerine).

İki ayrı bağlantı havuzu kullanır:
  - WRITE_POOL : Master'a yazma (master sunucuda kendisi, slave'de uzak master)
  - READ_POOL  : Local LDAP'ten okuma (her iki sunucuda kendisi)

Otomatik retry, TLS doğrulama, connection pooling.
"""

from __future__ import annotations

from contextlib import contextmanager
from typing import Any, Iterator

from ldap3 import ALL, SUBTREE, Connection, Server, ServerPool, Tls
from ldap3.core.exceptions import LDAPException
from ldap3.utils.conv import escape_filter_chars
import ssl

from app.core.config import get_settings
from app.core.logging import get_logger

logger = get_logger(__name__)


class LDAPError(Exception):
    """LDAP işlem hatası."""

    pass


class LDAPClient:
    """
    Thread-safe LDAP client (ldap3 + ssl.Tls).

    Tek instance uygulama yaşam döngüsü boyunca kullanılır.
    """

    def __init__(self) -> None:
        self._settings = get_settings()
        self._write_server = self._build_server(self._settings.ldap_url)
        self._read_server = self._build_server(self._settings.ldap_search_url)

    def _build_server(self, url: str) -> Server:
        """LDAP URL'inden Server objesi üret (TLS dahil).

        Eğer URL'de IP varsa (örn. ldaps://127.0.0.1:636), Python ssl
        sertifika hostname doğrulamasında patlar çünkü self-signed sertifika
        FQDN için üretilmiş. Bu durumda env'deki HOSTNAME ile SNI override
        ederiz.
        """
        from urllib.parse import urlparse

        parsed = urlparse(url)
        host = parsed.hostname or ""
        is_ip = host.replace(".", "").replace(":", "").isdigit() or ":" in host

        tls_config = None
        if url.startswith("ldaps://"):
            kwargs: dict[str, Any] = {
                "ca_certs_file": str(self._settings.ldap_ca_path),
                "validate": ssl.CERT_REQUIRED if self._settings.ldap_tls_verify else ssl.CERT_NONE,
                "version": ssl.PROTOCOL_TLS_CLIENT,
            }
            # Eğer hedef IP ise, SNI/sertifika doğrulama için hostname override
            # Önce master_url'den, sonra node_id'den hostname tahmin et
            if is_ip and self._settings.ldap_tls_verify:
                override_host = self._guess_cert_hostname(url)
                if override_host:
                    # ldap3 Tls içinde server_hostname parametresi YOK — onun yerine
                    # Server constructor'da host parametresini doğrudan FQDN ile veriyoruz.
                    # Bu fonksiyon ham URL'i kullanmıyor artık.
                    logger.info(
                        "ldap.tls.hostname_override",
                        original=host,
                        override=override_host,
                    )
                    # URL'i hostname'e dön
                    new_url = url.replace(host, override_host, 1)
                    return Server(
                        new_url,
                        get_info=ALL,
                        tls=Tls(**kwargs),
                        connect_timeout=self._settings.ldap_connect_timeout,
                    )
            tls_config = Tls(**kwargs)

        return Server(
            url,
            get_info=ALL,
            tls=tls_config,
            connect_timeout=self._settings.ldap_connect_timeout,
        )

    def _guess_cert_hostname(self, url: str) -> str | None:
        """
        Bir IP-URL için sertifikada eşleşecek hostname'i tahmin et.

        Sıra:
          1. Env'deki MTL_LDAP_TLS_HOSTNAME (explicit override)
          2. Slave ise master_url'in hostname'i
          3. Master ise node_id'den .mtl.local türet
          4. None — override yapma
        """
        from urllib.parse import urlparse

        # 1. Explicit override
        if self._settings.ldap_tls_hostname:
            return self._settings.ldap_tls_hostname

        # 2. Slave master'a bağlanırken master_url'i kullan
        if self._settings.is_slave and self._settings.master_url:
            master_host = urlparse(self._settings.master_url).hostname
            if master_host:
                return master_host

        # 3. Master kendi 127.0.0.1 üzerinden bağlanırken
        if self._settings.is_master:
            node_id = self._settings.node_id
            if "." not in node_id:
                return f"{node_id}.mtl.local"
            return node_id

        return None

    @contextmanager
    def write(self) -> Iterator[Connection]:
        """
        Write işlemleri için bind'lı bağlantı.

        Kullanım:
            with ldap_client.write() as conn:
                conn.add(dn, ...)
                if not conn.result["description"] == "success":
                    raise LDAPError(...)
        """
        yield from self._connection(self._write_server)

    @contextmanager
    def read(self) -> Iterator[Connection]:
        """Read işlemleri için (lokal LDAP)."""
        yield from self._connection(self._read_server)

    def _connection(self, server: Server) -> Iterator[Connection]:
        conn = None
        try:
            conn = Connection(
                server,
                user=self._settings.ldap_bind_dn,
                password=self._settings.ldap_bind_password.get_secret_value(),
                auto_bind=True,
                receive_timeout=self._settings.ldap_receive_timeout,
                raise_exceptions=False,
            )
            yield conn
        except LDAPException as e:
            logger.error("ldap.connection.error", error=str(e), server=str(server))
            raise LDAPError(f"LDAP bağlantı hatası: {e}") from e
        finally:
            if conn and conn.bound:
                conn.unbind()

    def bind_as(self, user_dn: str, password: str) -> bool:
        """
        Belirli bir kullanıcı DN ile bind dene (login için).

        Returns:
            True: bind başarılı (parola doğru)
            False: bind başarısız (parola yanlış veya başka hata)
        """
        try:
            tls_config = self._write_server.tls
            conn = Connection(
                self._write_server,
                user=user_dn,
                password=password,
                auto_bind=False,
                receive_timeout=self._settings.ldap_receive_timeout,
                raise_exceptions=False,
            )
            result = conn.bind()
            if conn.bound:
                conn.unbind()
            return bool(result)
        except LDAPException as e:
            logger.warning("ldap.bind_as.failed", dn=user_dn, error=str(e))
            return False

    def search_user_by_uid(self, uid: str) -> dict[str, Any] | None:
        """
        UID ile kullanıcı ara (login flow için).

        Returns:
            Kullanıcı entry'si (dn + attributes) veya None.
        """
        safe_uid = escape_filter_chars(uid)
        base = f"ou=people,{self._settings.ldap_base_dn}"
        with self.read() as conn:
            conn.search(
                search_base=base,
                search_filter=f"(uid={safe_uid})",
                search_scope=SUBTREE,
                attributes=[
                    "uid", "cn", "sn", "givenName", "displayName", "mail",
                    "telephoneNumber", "mtlMfaEnabled", "mtlPreferredLanguage",
                    "mtlSecurityFlags",
                ],
            )
            if not conn.entries:
                return None
            entry = conn.entries[0]
            return {
                "dn": entry.entry_dn,
                "attributes": {attr: entry[attr].values for attr in entry.entry_attributes},
            }

    def search(
        self,
        base: str | None = None,
        filter: str = "(objectClass=*)",
        attributes: list[str] | None = None,
        scope: str = SUBTREE,
        size_limit: int = 1000,
    ) -> list[dict[str, Any]]:
        """Genel LDAP arama."""
        base = base or self._settings.ldap_base_dn
        with self.read() as conn:
            conn.search(
                search_base=base,
                search_filter=filter,
                search_scope=scope,
                attributes=attributes or ["*"],
                size_limit=size_limit,
            )
            return [
                {
                    "dn": e.entry_dn,
                    "attributes": {attr: e[attr].values for attr in e.entry_attributes},
                }
                for e in conn.entries
            ]


_client: LDAPClient | None = None


def init_ldap() -> LDAPClient:
    """LDAP client'ı başlat (lifespan startup'da)."""
    global _client
    if _client is None:
        settings = get_settings()
        logger.info(
            "ldap.client.init",
            write_url=settings.ldap_url,
            read_url=settings.ldap_search_url,
            base_dn=settings.ldap_base_dn,
        )
        _client = LDAPClient()
    return _client


def dispose_ldap() -> None:
    """Şimdilik no-op (ldap3 connection per-request açıyor)."""
    global _client
    _client = None


def get_ldap() -> LDAPClient:
    """FastAPI dependency."""
    if _client is None:
        raise RuntimeError("LDAP client başlatılmadı — init_ldap() çağrılmalı")
    return _client


async def check_ldap_health() -> dict[str, Any]:
    """Healthcheck için: bind + base DN aranabilir mi?"""
    try:
        client = get_ldap()
        with client.read() as conn:
            conn.search(
                search_base=client._settings.ldap_base_dn,
                search_filter="(objectClass=*)",
                search_scope="BASE",
                attributes=["contextCSN"],
            )
            entries = conn.entries
            csn = None
            if entries and "contextCSN" in entries[0].entry_attributes:
                csn = entries[0]["contextCSN"].value
        return {
            "status": "healthy",
            "context_csn": str(csn) if csn else None,
        }
    except Exception as e:
        return {"status": "unhealthy", "error": str(e)}
