-- SPDX-License-Identifier: Apache-2.0
-- Copyright 2026 Mutlu Erol
--
-- MTL LDAP Admin — Tur 5 Migration
--
-- Slave-side parola reset portal + end_user self-service için.
--
-- Yeni eklenenler:
--   1. mtl_core.password_reset_request   (OTP token + hash + attempts)
--   2. mtl_core.user_self_service_log    (end_user kendi işlemleri)
--   3. mtl_core.end_user_mfa_secret      (end_user TOTP için, Fernet-encrypted)
--   4. bulk_import_job.job_type CHECK genişletme (user_delete, user_bulk_update)
--
-- Master ve slave'de çalışır (master'da end_user MFA için, slave'de hepsi için).
-- Idempotent.

BEGIN;

-- ============================================================================
-- 1. mtl_core.password_reset_request — OTP token kayıtları
-- ============================================================================

CREATE TABLE IF NOT EXISTS mtl_core.password_reset_request (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    target_uid              TEXT NOT NULL,
    target_email            TEXT,
    target_ldap_dn          TEXT,
    otp_hash                TEXT NOT NULL,
    issued_at               TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    expires_at              TIMESTAMP WITH TIME ZONE NOT NULL,
    attempts                INTEGER NOT NULL DEFAULT 0,
    max_attempts            INTEGER NOT NULL DEFAULT 5,
    consumed_at             TIMESTAMP WITH TIME ZONE,
    completion_token_hash   TEXT,
    completion_expires_at   TIMESTAMP WITH TIME ZONE,
    completed_at            TIMESTAMP WITH TIME ZONE,
    request_ip              INET,
    request_user_agent      TEXT,
    status                  TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending','verified','completed','expired','cancelled','locked'))
);

CREATE INDEX IF NOT EXISTS ix_pwd_reset_target_uid
    ON mtl_core.password_reset_request (target_uid, issued_at DESC);
CREATE INDEX IF NOT EXISTS ix_pwd_reset_status_expires
    ON mtl_core.password_reset_request (status, expires_at);
CREATE INDEX IF NOT EXISTS ix_pwd_reset_completion_token
    ON mtl_core.password_reset_request (completion_token_hash)
    WHERE completion_token_hash IS NOT NULL;

COMMENT ON TABLE mtl_core.password_reset_request IS
    'Slave: end_user parola reset talepleri. OTP üretilir, e-posta ile gönderilir, '
    'OTP doğrulanırsa completion_token verilir, yeni parola ile tamamlanır.';


-- ============================================================================
-- 2. mtl_core.user_self_service_log — end_user kendi işlemleri (slave audit)
-- ============================================================================

CREATE TABLE IF NOT EXISTS mtl_core.user_self_service_log (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    occurred_at             TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    event_code              TEXT NOT NULL,
    target_uid              TEXT NOT NULL,
    target_email            TEXT,
    successful              BOOLEAN NOT NULL DEFAULT true,
    ip_address              INET,
    user_agent              TEXT,
    error_code              TEXT,
    error_message           TEXT,
    extra                   JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS ix_user_ss_log_uid
    ON mtl_core.user_self_service_log (target_uid, occurred_at DESC);
CREATE INDEX IF NOT EXISTS ix_user_ss_log_event
    ON mtl_core.user_self_service_log (event_code, occurred_at DESC);

COMMENT ON TABLE mtl_core.user_self_service_log IS
    'End-user self-service işlemleri: password reset request/complete, MFA enroll, login.';


-- ============================================================================
-- 3. mtl_core.end_user_mfa_secret — end_user TOTP secret (Fernet-encrypted)
-- ============================================================================

CREATE TABLE IF NOT EXISTS mtl_core.end_user_mfa_secret (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    target_uid              TEXT NOT NULL UNIQUE,
    secret_encrypted        TEXT NOT NULL,
    enabled                 BOOLEAN NOT NULL DEFAULT false,
    enrolled_at             TIMESTAMP WITH TIME ZONE,
    last_used_at            TIMESTAMP WITH TIME ZONE,
    recovery_codes_hash     JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at              TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_end_user_mfa_uid
    ON mtl_core.end_user_mfa_secret (target_uid);

COMMENT ON TABLE mtl_core.end_user_mfa_secret IS
    'End-user TOTP MFA secret (Fernet-encrypted). LDAP attribute alternatifi — '
    'DB''de tutmak hem schema esnek hem de rotation kolay.';


-- ============================================================================
-- 4. bulk_import_job.job_type CHECK genişletme
-- ============================================================================

DO $$
BEGIN
    ALTER TABLE mtl_core.bulk_import_job DROP CONSTRAINT IF EXISTS bulk_import_job_job_type_check;

    ALTER TABLE mtl_core.bulk_import_job ADD CONSTRAINT bulk_import_job_job_type_check
        CHECK (job_type IN (
            'user_create',
            'user_update',
            'user_delete',
            'user_bulk_update',
            'group_create',
            'group_membership'
        ));
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'bulk_import_job constraint güncellemesi atlandı: %', SQLERRM;
END $$;


-- ============================================================================
-- 5. Hak verme
-- ============================================================================

GRANT ALL ON mtl_core.password_reset_request TO mtl_admin;
GRANT ALL ON mtl_core.user_self_service_log TO mtl_admin;
GRANT ALL ON mtl_core.end_user_mfa_secret TO mtl_admin;


COMMIT;

\echo '=========================================='
\echo 'Tur 5 Migration Tamamlandı'
\echo '=========================================='

SELECT 'Yeni tablolar' AS info, count(*) AS sayi
FROM information_schema.tables
WHERE table_schema='mtl_core'
  AND table_name IN ('password_reset_request','user_self_service_log','end_user_mfa_secret');

SELECT 'bulk_import_job CHECK güncel mi (user_delete var mı)' AS info,
       CASE WHEN consrc IS NULL THEN
           (SELECT pg_get_constraintdef(c.oid)
            FROM pg_constraint c
            JOIN pg_class t ON c.conrelid = t.oid
            JOIN pg_namespace n ON t.relnamespace = n.oid
            WHERE n.nspname='mtl_core'
              AND t.relname='bulk_import_job'
              AND c.conname='bulk_import_job_job_type_check')
       ELSE consrc END AS detay
FROM (SELECT NULL::text AS consrc) x;
