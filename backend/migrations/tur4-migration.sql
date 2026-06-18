-- SPDX-License-Identifier: Apache-2.0
-- Copyright 2026 Mutlu Erol
--
-- MTL LDAP Admin — Tur 4 Migration
--
-- Yeni eklenenler:
--   1. mtl_cluster                          (yeni schema)
--   2. mtl_cluster.node                     (master+slave node kayıtları)
--   3. mtl_cluster.sync_queue               (audit forward retry queue)
--   4. mtl_alert                            (yeni schema)
--   5. mtl_alert.rule                       (alert kural tanımları)
--   6. mtl_alert.event                      (tetiklenen alert'lar)
--   7. mtl_core.password_change_token       (must_change flow için kısa ömürlü token)
--
-- Idempotent: her şey "IF NOT EXISTS" / "ADD COLUMN IF NOT EXISTS".
-- Master'da çalıştırın.

BEGIN;

-- ============================================================================
-- 1. Schemas
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS mtl_cluster;
CREATE SCHEMA IF NOT EXISTS mtl_alert;

GRANT USAGE ON SCHEMA mtl_cluster TO mtl_admin;
GRANT USAGE ON SCHEMA mtl_alert TO mtl_admin;
ALTER DEFAULT PRIVILEGES IN SCHEMA mtl_cluster GRANT ALL ON TABLES TO mtl_admin;
ALTER DEFAULT PRIVILEGES IN SCHEMA mtl_alert GRANT ALL ON TABLES TO mtl_admin;


-- ============================================================================
-- 2. mtl_cluster.node — cluster node kayıtları
-- ============================================================================

CREATE TABLE IF NOT EXISTS mtl_cluster.node (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    node_id                 TEXT NOT NULL UNIQUE,
    node_type               TEXT NOT NULL CHECK (node_type IN ('MASTER','SLAVE')),
    hostname                TEXT NOT NULL,
    base_url                TEXT NOT NULL,
    status                  TEXT NOT NULL DEFAULT 'unknown'
        CHECK (status IN ('online','offline','degraded','unknown','syncing')),
    last_heartbeat_at       TIMESTAMP WITH TIME ZONE,
    last_sync_at            TIMESTAMP WITH TIME ZONE,
    version                 TEXT,
    metadata                JSONB NOT NULL DEFAULT '{}'::jsonb,
    registered_at           TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    updated_at              TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_cluster_node_status ON mtl_cluster.node (status);
CREATE INDEX IF NOT EXISTS ix_cluster_node_last_heartbeat ON mtl_cluster.node (last_heartbeat_at DESC);

COMMENT ON TABLE mtl_cluster.node IS
    'Cluster topolojisi — master ve slave node''ları, heartbeat ve sync durumlarıyla';


-- ============================================================================
-- 3. mtl_cluster.sync_queue — retry queue (audit forwarding için)
-- ============================================================================

CREATE TABLE IF NOT EXISTS mtl_cluster.sync_queue (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    target_node_id          TEXT NOT NULL,
    payload_type            TEXT NOT NULL CHECK (payload_type IN (
        'AUDIT_EVENT','CONFIG_SYNC','CLUSTER_MESSAGE'
    )),
    payload                 JSONB NOT NULL,
    queued_at               TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    attempts                INTEGER NOT NULL DEFAULT 0,
    max_attempts            INTEGER NOT NULL DEFAULT 5,
    next_attempt_at         TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    last_attempt_at         TIMESTAMP WITH TIME ZONE,
    last_error              TEXT,
    status                  TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending','sent','failed','abandoned')),
    sent_at                 TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS ix_sync_queue_pending
    ON mtl_cluster.sync_queue (next_attempt_at)
    WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS ix_sync_queue_target
    ON mtl_cluster.sync_queue (target_node_id, status);

COMMENT ON TABLE mtl_cluster.sync_queue IS
    'Master→slave veya slave→master gönderim kuyruğu. Exponential backoff ile retry.';


-- ============================================================================
-- 4. mtl_alert.rule — alert kural tanımları
-- ============================================================================

CREATE TABLE IF NOT EXISTS mtl_alert.rule (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    rule_code               TEXT NOT NULL UNIQUE,
    name                    TEXT NOT NULL,
    description             TEXT,
    severity                TEXT NOT NULL DEFAULT 'WARNING'
        CHECK (severity IN ('INFO','NOTICE','WARNING','ERROR','CRITICAL')),
    rule_type               TEXT NOT NULL CHECK (rule_type IN (
        'FAILED_LOGIN_SPIKE',
        'ACCOUNT_LOCKOUT_BURST',
        'MFA_BYPASS_ATTEMPT',
        'PRIVILEGE_ESCALATION',
        'ADMIN_CREATED',
        'ROLE_ASSIGNED',
        'BULK_DELETE',
        'CUSTOM'
    )),
    enabled                 BOOLEAN NOT NULL DEFAULT true,
    threshold_count         INTEGER NOT NULL DEFAULT 5,
    window_minutes          INTEGER NOT NULL DEFAULT 15,
    cooldown_minutes        INTEGER NOT NULL DEFAULT 60,
    notify_channels         JSONB NOT NULL DEFAULT '[]'::jsonb,
    extra_config            JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at              TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    updated_at              TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    last_triggered_at       TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS ix_alert_rule_enabled ON mtl_alert.rule (enabled, rule_type);

COMMENT ON TABLE mtl_alert.rule IS
    'Alert engine kural tanımları. Beat task event_log üzerinde sliding window analiz yapar.';


-- ============================================================================
-- 5. mtl_alert.event — tetiklenen alert'lar
-- ============================================================================

CREATE TABLE IF NOT EXISTS mtl_alert.event (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    rule_id                 UUID NOT NULL REFERENCES mtl_alert.rule(id) ON DELETE CASCADE,
    triggered_at            TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    severity                TEXT NOT NULL,
    summary                 TEXT NOT NULL,
    matched_events          JSONB NOT NULL DEFAULT '[]'::jsonb,
    event_count             INTEGER NOT NULL DEFAULT 0,
    window_start            TIMESTAMP WITH TIME ZONE,
    window_end              TIMESTAMP WITH TIME ZONE,

    status                  TEXT NOT NULL DEFAULT 'open'
        CHECK (status IN ('open','acknowledged','resolved','suppressed')),
    acknowledged_at         TIMESTAMP WITH TIME ZONE,
    acknowledged_by         UUID REFERENCES mtl_core.admin_account(id) ON DELETE SET NULL,
    resolved_at             TIMESTAMP WITH TIME ZONE,
    resolved_by             UUID REFERENCES mtl_core.admin_account(id) ON DELETE SET NULL,
    resolution_note         TEXT,

    extra_details           JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS ix_alert_event_status
    ON mtl_alert.event (status, triggered_at DESC);
CREATE INDEX IF NOT EXISTS ix_alert_event_rule
    ON mtl_alert.event (rule_id, triggered_at DESC);
CREATE INDEX IF NOT EXISTS ix_alert_event_severity
    ON mtl_alert.event (severity, status);

COMMENT ON TABLE mtl_alert.event IS
    'Tetiklenen alert''lar. Admin ack/resolve eder.';


-- ============================================================================
-- 6. mtl_core.password_change_token — kısa ömürlü token (must_change flow)
-- ============================================================================

CREATE TABLE IF NOT EXISTS mtl_core.password_change_token (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    admin_id                UUID NOT NULL REFERENCES mtl_core.admin_account(id) ON DELETE CASCADE,
    token_hash              TEXT NOT NULL UNIQUE,
    issued_at               TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    expires_at              TIMESTAMP WITH TIME ZONE NOT NULL,
    consumed_at             TIMESTAMP WITH TIME ZONE,
    issued_ip               INET,
    issued_user_agent       TEXT
);

CREATE INDEX IF NOT EXISTS ix_pwd_change_token_admin
    ON mtl_core.password_change_token (admin_id) WHERE consumed_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_pwd_change_token_expires
    ON mtl_core.password_change_token (expires_at);

COMMENT ON TABLE mtl_core.password_change_token IS
    'must_change_password=true ise login''de verilen kısa ömürlü token (5 dk). Sadece /auth/change-password endpoint''ini açar.';


-- ============================================================================
-- 7. Updated_at trigger'ları
-- ============================================================================

CREATE OR REPLACE FUNCTION mtl_cluster.update_node_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS trg_cluster_node_updated_at ON mtl_cluster.node;
CREATE TRIGGER trg_cluster_node_updated_at
    BEFORE UPDATE ON mtl_cluster.node
    FOR EACH ROW EXECUTE FUNCTION mtl_cluster.update_node_updated_at();

CREATE OR REPLACE FUNCTION mtl_alert.update_rule_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS trg_alert_rule_updated_at ON mtl_alert.rule;
CREATE TRIGGER trg_alert_rule_updated_at
    BEFORE UPDATE ON mtl_alert.rule
    FOR EACH ROW EXECUTE FUNCTION mtl_alert.update_rule_updated_at();


-- ============================================================================
-- 8. Default alert rule'ları seed et
-- ============================================================================

INSERT INTO mtl_alert.rule (rule_code, name, description, severity, rule_type, threshold_count, window_minutes, cooldown_minutes)
VALUES
    ('failed_login_spike',
     'Başarısız Giriş Atağı',
     'Aynı kullanıcı veya IP''den belirli süre içinde çok sayıda başarısız giriş denemesi',
     'WARNING', 'FAILED_LOGIN_SPIKE', 10, 5, 30),

    ('account_lockout_burst',
     'Hesap Kilitlenme Yoğunluğu',
     'Kısa süre içinde çok sayıda hesabın kilitlenmesi (koordineli atak göstergesi)',
     'ERROR', 'ACCOUNT_LOCKOUT_BURST', 5, 15, 60),

    ('mfa_bypass_attempt',
     'MFA Bypass Denemesi',
     'MFA aktif kullanıcıda başarılı parola + başarısız MFA örüntüsü',
     'CRITICAL', 'MFA_BYPASS_ATTEMPT', 3, 10, 30),

    ('privilege_escalation',
     'Yetki Yükseltme',
     'super_admin rolünün atanması',
     'WARNING', 'PRIVILEGE_ESCALATION', 1, 1440, 1),

    ('admin_created',
     'Yeni Admin Oluşturma',
     'Yeni admin hesabı oluşturuldu',
     'NOTICE', 'ADMIN_CREATED', 1, 1440, 1),

    ('bulk_delete_warning',
     'Toplu Silme İşlemi',
     'Toplu kullanıcı silme operasyonu tespit edildi',
     'WARNING', 'BULK_DELETE', 1, 1440, 1)
ON CONFLICT (rule_code) DO NOTHING;


-- ============================================================================
-- 9. Bu master node'u tabloya ekle (idempotent)
-- ============================================================================

DO $$
BEGIN
    -- Eğer ortam değişkeninden alamıyorsak default ekle; admin sonradan günceller
    INSERT INTO mtl_cluster.node (node_id, node_type, hostname, base_url, status)
    VALUES ('mtl-master-01', 'MASTER', 'mtl-master-01.mtl.local',
            'https://mtl-master-01.mtl.local', 'online')
    ON CONFLICT (node_id) DO NOTHING;
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'Master node insert atlandı: %', SQLERRM;
END $$;


COMMIT;

\echo '=========================================='
\echo 'Tur 4 Migration Tamamlandı'
\echo '=========================================='

SELECT 'Yeni schema''lar' AS info, count(*) AS sayi
FROM information_schema.schemata
WHERE schema_name IN ('mtl_cluster', 'mtl_alert');

SELECT 'Yeni tablolar' AS info, count(*) AS sayi
FROM information_schema.tables
WHERE table_schema IN ('mtl_cluster','mtl_alert')
   OR (table_schema='mtl_core' AND table_name='password_change_token');

SELECT 'Seed alert kuralı' AS info, count(*) AS sayi FROM mtl_alert.rule;
SELECT 'Cluster node kayıtları' AS info, count(*) AS sayi FROM mtl_cluster.node;
