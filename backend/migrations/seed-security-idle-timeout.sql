-- SPDX-License-Identifier: Apache-2.0
-- security.idle_timeout_minutes ayarini idempotent ekler (default 15dk; 0 = kapali).
INSERT INTO mtl_core.system_setting
  (category, key, value, value_type, is_sensitive, is_editable, description, default_value, description_en)
VALUES
  ('security', 'security.idle_timeout_minutes', '15', 'integer', false, true,
   'Yönetici oturumu kaç dakika hareketsiz kalırsa otomatik çıkış yapılır (0 = kapalı).',
   '15',
   'Minutes of admin inactivity before automatic logout (0 = disabled).')
ON CONFLICT (category, key) DO NOTHING;

SELECT category, key, value, value_type FROM mtl_core.system_setting
 WHERE category='security' AND key='security.idle_timeout_minutes';
