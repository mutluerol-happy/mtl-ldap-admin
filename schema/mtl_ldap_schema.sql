-- SPDX-License-Identifier: Apache-2.0
-- Copyright 2026 Mutlu Erol
--
-- ============================================================
-- MTL LDAP — Slave (Parola Reset Portali) PostgreSQL Şeması
-- ============================================================
-- Slave sunucusunda çalışan mtl-ldap servisinin yerel veritabanı.
-- Daha sade — yalnızca oturum, lokal audit buffer ve sınırlı ayarlar.
-- Tüm gerçek yönetim verisi master'da tutulur.
--
-- Önkoşul:
--   CREATE DATABASE mtl_ldap;
--   CREATE USER mtl_slave WITH PASSWORD '...';
--   GRANT ALL ON DATABASE mtl_ldap TO mtl_slave;
-- ============================================================

CREATE SCHEMA IF NOT EXISTS mtl_core;
CREATE SCHEMA IF NOT EXISTS mtl_audit;

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- mtl_core (slave)
-- ============================================================

-- Son kullanıcı oturumları
CREATE TABLE mtl_core.session (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    subject_type  text NOT NULL DEFAULT 'END_USER' CHECK (subject_type = 'END_USER'),
    subject_id    text NOT NULL,
    token_hash    text NOT NULL,
    created_at    timestamptz NOT NULL DEFAULT now(),
    last_seen_at  timestamptz NOT NULL DEFAULT now(),
    expires_at    timestamptz NOT NULL,
    ip_address    inet,
    user_agent    text,
    country_code  char(2),
    is_revoked    boolean NOT NULL DEFAULT false
);
CREATE INDEX idx_session_subject ON mtl_core.session (subject_id);
CREATE INDEX idx_session_token_hash ON mtl_core.session (token_hash);
CREATE INDEX idx_session_expires ON mtl_core.session (expires_at);

-- MFA bekleyen kayıtlar (kullanıcı kendi MFA'sını aktive ederken)
CREATE TABLE mtl_core.mfa_pending_enrollment (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    subject_dn      text NOT NULL,
    secret_encrypted text NOT NULL,
    created_at      timestamptz NOT NULL DEFAULT now(),
    expires_at      timestamptz NOT NULL
);

-- Parola sıfırlama tokenleri (slave portal üzerinden başlatılan)
CREATE TABLE mtl_core.password_reset_token (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    subject_dn  text NOT NULL,
    channel     text NOT NULL CHECK (channel IN ('EMAIL', 'SMS', 'OTP')),
    token_hash  text NOT NULL UNIQUE,
    expires_at  timestamptz NOT NULL,
    consumed_at timestamptz,
    created_at  timestamptz NOT NULL DEFAULT now(),
    ip_address  inet
);

-- Sınırlı slave ayarları
CREATE TABLE mtl_core.settings (
    key         text PRIMARY KEY,
    value       jsonb NOT NULL,
    category    text NOT NULL,
    is_secret   boolean NOT NULL DEFAULT false,
    description text,
    updated_at  timestamptz NOT NULL DEFAULT now()
);

-- ============================================================
-- mtl_audit (slave) — lokal buffer
-- ============================================================
-- Slave kendi olaylarını burada saklar; periyodik shipper master'a push eder.

CREATE TABLE mtl_audit.event_log (
    id               bigserial PRIMARY KEY,
    occurred_at      timestamptz NOT NULL DEFAULT now(),
    server_node      text NOT NULL,
    category         text NOT NULL,
    event_code       text NOT NULL,
    severity         text NOT NULL DEFAULT 'INFO'
                     CHECK (severity IN ('INFO', 'NOTICE', 'WARNING', 'ERROR', 'CRITICAL')),
    actor_type       text,
    actor_id         text,
    actor_display    text,
    target_type      text,
    target_id        text,
    target_display   text,
    ip_address       inet,
    user_agent       text,
    country_code     char(2),
    request_id       uuid,
    details          jsonb NOT NULL DEFAULT '{}'::jsonb,
    shipped_at       timestamptz,         -- master'a gönderildiği zaman; NULL ise henüz gönderilmedi
    ship_attempts    integer NOT NULL DEFAULT 0,
    last_ship_error  text
);
CREATE INDEX idx_audit_pending_ship ON mtl_audit.event_log (occurred_at) WHERE shipped_at IS NULL;
CREATE INDEX idx_audit_shipped ON mtl_audit.event_log (shipped_at);

-- Append-only — yalnızca shipped_at güncellenebilir
CREATE OR REPLACE FUNCTION mtl_audit.allow_only_shipping_update()
RETURNS trigger AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'event_log kayıtları silinemez';
    END IF;
    IF TG_OP = 'UPDATE' THEN
        -- Sadece shipped_at, ship_attempts ve last_ship_error değiştirilebilir
        IF (OLD.id, OLD.occurred_at, OLD.server_node, OLD.category, OLD.event_code,
            OLD.severity, OLD.actor_type, OLD.actor_id, OLD.target_type, OLD.target_id,
            OLD.ip_address, OLD.details)
           IS DISTINCT FROM
           (NEW.id, NEW.occurred_at, NEW.server_node, NEW.category, NEW.event_code,
            NEW.severity, NEW.actor_type, NEW.actor_id, NEW.target_type, NEW.target_id,
            NEW.ip_address, NEW.details)
        THEN
            RAISE EXCEPTION 'event_log içerik alanları değiştirilemez';
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_slave_audit_immutable
BEFORE UPDATE OR DELETE ON mtl_audit.event_log
FOR EACH ROW EXECUTE FUNCTION mtl_audit.allow_only_shipping_update();

-- ============================================================
-- Slave varsayılan ayarları
-- ============================================================

INSERT INTO mtl_core.settings (key, value, category, is_secret, description) VALUES
    ('cluster.log_ship_interval_seconds',     '30'::jsonb,  'cluster', false, 'Log gönderim aralığı'),
    ('cluster.log_ship_batch_size',           '500'::jsonb, 'cluster', false, 'Batch başına olay sayısı'),
    ('cluster.log_ship_max_retries',          '5'::jsonb,   'cluster', false, 'Başarısız gönderim için maks. tekrar'),
    ('security.session_idle_timeout_minutes', '30'::jsonb,  'security', false, 'Boş kalma oturum süresi'),
    ('security.session_absolute_timeout_hours','12'::jsonb, 'security', false, 'Mutlak oturum süresi'),
    ('reset_password.allowed_profile_fields',
        '["telephoneNumber","mobile","profilePhoto","preferredLanguage"]'::jsonb,
        'reset_password', false, 'Kullanıcının kendi profilinde değiştirebileceği LDAP alanları'),
    ('branding.product_display_name',         '"MTL Parola Reset"'::jsonb, 'branding', false, 'Görünen ürün adı'),
    ('branding.primary_color',                '"#2563eb"'::jsonb,  'branding', false, 'Ana marka rengi'),
    ('i18n.default_language',                 '"tr"'::jsonb, 'branding', false, 'Varsayılan dil')
ON CONFLICT (key) DO NOTHING;

-- ============================================================
-- Bilgi
-- ============================================================
COMMENT ON SCHEMA mtl_core  IS 'MTL LDAP (slave) — lokal session, MFA bekleyenler, sınırlı ayarlar';
COMMENT ON SCHEMA mtl_audit IS 'MTL LDAP (slave) — lokal audit buffer, master''a shipping bekleyenler';
