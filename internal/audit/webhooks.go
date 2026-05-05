package audit

import (
	"crypto/hmac"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"strings"
	"time"
)

// migrateWebhooks webhook tablolarını kurar.
func migrateWebhooks(db *sql.DB) error {
	_, err := db.Exec(`
CREATE TABLE IF NOT EXISTS webhooks (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	name TEXT NOT NULL UNIQUE,
	url TEXT NOT NULL,
	kind TEXT NOT NULL DEFAULT 'generic',  -- generic | slack | discord
	secret TEXT NOT NULL DEFAULT '',
	events TEXT NOT NULL DEFAULT '*',       -- comma-separated audit actions, * = all
	enabled INTEGER NOT NULL DEFAULT 1,
	created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS webhook_deliveries (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	webhook_id INTEGER NOT NULL,
	ts INTEGER NOT NULL,
	action TEXT NOT NULL,
	status TEXT NOT NULL,        -- ok | failed
	http_status INTEGER,
	error TEXT,
	FOREIGN KEY(webhook_id) REFERENCES webhooks(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_wd_ts ON webhook_deliveries(ts DESC);
CREATE INDEX IF NOT EXISTS idx_wd_wh ON webhook_deliveries(webhook_id);
`)
	return err
}

type Webhook struct {
	ID        int64     `json:"id"`
	Name      string    `json:"name"`
	URL       string    `json:"url"`
	Kind      string    `json:"kind"`             // generic | slack | discord
	Secret    string    `json:"secret,omitempty"` // HMAC secret (sadece create dönüşünde)
	Events    string    `json:"events"`           // CSV of actions or "*"
	Enabled   bool      `json:"enabled"`
	CreatedAt time.Time `json:"createdAt"`
}

type WebhookInput struct {
	Name    string `json:"name"`
	URL     string `json:"url"`
	Kind    string `json:"kind"`
	Secret  string `json:"secret"`
	Events  string `json:"events"`
	Enabled bool   `json:"enabled"`
}

func (s *Store) ListWebhooks() ([]Webhook, error) {
	rows, err := s.db.Query(`SELECT id, name, url, kind, events, enabled, created_at FROM webhooks ORDER BY name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Webhook{}
	for rows.Next() {
		var w Webhook
		var enabled int
		var created int64
		if err := rows.Scan(&w.ID, &w.Name, &w.URL, &w.Kind, &w.Events, &enabled, &created); err != nil {
			return nil, err
		}
		w.Enabled = enabled == 1
		w.CreatedAt = time.UnixMilli(created).UTC()
		// Secret listede dönmez
		out = append(out, w)
	}
	return out, rows.Err()
}

// ListEnabledWebhooksFor verilen action için tetiklenecek webhook'ları döner; secret dahil.
func (s *Store) ListEnabledWebhooksFor(action string) ([]Webhook, error) {
	rows, err := s.db.Query(`SELECT id, name, url, kind, secret, events FROM webhooks WHERE enabled = 1`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Webhook{}
	for rows.Next() {
		var w Webhook
		if err := rows.Scan(&w.ID, &w.Name, &w.URL, &w.Kind, &w.Secret, &w.Events); err != nil {
			return nil, err
		}
		if matchesEvent(w.Events, action) {
			out = append(out, w)
		}
	}
	return out, rows.Err()
}

func matchesEvent(pattern, action string) bool {
	if pattern == "" || pattern == "*" {
		return true
	}
	for _, p := range strings.Split(pattern, ",") {
		p = strings.TrimSpace(p)
		if p == "" {
			continue
		}
		if p == action {
			return true
		}
		// "user.*" gibi prefix wildcard
		if strings.HasSuffix(p, ".*") && strings.HasPrefix(action, strings.TrimSuffix(p, "*")) {
			return true
		}
	}
	return false
}

func (s *Store) SaveWebhook(in WebhookInput) (*Webhook, error) {
	if in.Name == "" || in.URL == "" {
		return nil, fmt.Errorf("name ve url zorunlu")
	}
	if in.Kind == "" {
		in.Kind = "generic"
	}
	if in.Events == "" {
		in.Events = "*"
	}
	enabled := 0
	if in.Enabled {
		enabled = 1
	}
	res, err := s.db.Exec(`
INSERT INTO webhooks (name, url, kind, secret, events, enabled, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(name) DO UPDATE SET url=excluded.url, kind=excluded.kind, secret=excluded.secret, events=excluded.events, enabled=excluded.enabled`,
		in.Name, in.URL, in.Kind, in.Secret, in.Events, enabled, time.Now().UnixMilli(),
	)
	if err != nil {
		return nil, err
	}
	id, _ := res.LastInsertId()
	return &Webhook{
		ID: id, Name: in.Name, URL: in.URL, Kind: in.Kind,
		Secret: in.Secret, Events: in.Events, Enabled: in.Enabled,
		CreatedAt: time.Now().UTC(),
	}, nil
}

func (s *Store) DeleteWebhook(name string) error {
	_, err := s.db.Exec(`DELETE FROM webhooks WHERE name = ?`, name)
	return err
}

type Delivery struct {
	ID         int64     `json:"id"`
	WebhookID  int64     `json:"webhookId"`
	Timestamp  time.Time `json:"timestamp"`
	Action     string    `json:"action"`
	Status     string    `json:"status"`
	HTTPStatus int       `json:"httpStatus"`
	Error      string    `json:"error,omitempty"`
}

func (s *Store) RecordDelivery(webhookID int64, action, status string, httpStatus int, errMsg string) {
	_, _ = s.db.Exec(
		`INSERT INTO webhook_deliveries (webhook_id, ts, action, status, http_status, error) VALUES (?, ?, ?, ?, ?, ?)`,
		webhookID, time.Now().UnixMilli(), action, status, httpStatus, errMsg,
	)
}

func (s *Store) ListDeliveries(webhookID int64, limit int) ([]Delivery, error) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	rows, err := s.db.Query(
		`SELECT id, webhook_id, ts, action, status, COALESCE(http_status, 0), COALESCE(error, '')
		 FROM webhook_deliveries WHERE webhook_id = ? ORDER BY id DESC LIMIT ?`,
		webhookID, limit,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Delivery{}
	for rows.Next() {
		var d Delivery
		var ts int64
		if err := rows.Scan(&d.ID, &d.WebhookID, &ts, &d.Action, &d.Status, &d.HTTPStatus, &d.Error); err != nil {
			return nil, err
		}
		d.Timestamp = time.UnixMilli(ts).UTC()
		out = append(out, d)
	}
	return out, rows.Err()
}

// SignPayload HMAC-SHA256 imza üretir; secret boşsa "".
func SignPayload(body []byte, secret string) string {
	if secret == "" {
		return ""
	}
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write(body)
	return hex.EncodeToString(mac.Sum(nil))
}

// FormatPayload kind'a göre payload üretir.
// generic: ham audit entry. slack/discord: text mesaj.
func FormatPayload(kind string, e Entry) ([]byte, string, error) {
	switch strings.ToLower(kind) {
	case "slack":
		return formatSlack(e)
	case "discord":
		return formatDiscord(e)
	default:
		body, err := json.Marshal(e)
		return body, "application/json", err
	}
}

func formatSlack(e Entry) ([]byte, string, error) {
	emoji := ":white_check_mark:"
	if e.Status == string(StatusFail) {
		emoji = ":x:"
	}
	text := fmt.Sprintf("%s *%s* by `%s`%s%s",
		emoji, e.Action, e.Actor,
		ifThen(e.Target != "", " on `"+e.Target+"`"),
		ifThen(e.Details != "", " — "+e.Details),
	)
	body, err := json.Marshal(map[string]any{"text": text})
	return body, "application/json", err
}

func formatDiscord(e Entry) ([]byte, string, error) {
	color := 0x10b981
	if e.Status == string(StatusFail) {
		color = 0xef4444
	}
	body, err := json.Marshal(map[string]any{
		"embeds": []map[string]any{{
			"title": e.Action,
			"color": color,
			"fields": []map[string]any{
				{"name": "actor", "value": orDash(e.Actor), "inline": true},
				{"name": "target", "value": orDash(e.Target), "inline": true},
				{"name": "ip", "value": orDash(e.IP), "inline": true},
				{"name": "status", "value": e.Status, "inline": true},
				{"name": "details", "value": orDash(e.Details), "inline": false},
			},
			"timestamp": e.Timestamp.Format(time.RFC3339),
		}},
	})
	return body, "application/json", err
}

func ifThen(cond bool, s string) string {
	if cond {
		return s
	}
	return ""
}
func orDash(s string) string {
	if s == "" {
		return "—"
	}
	return s
}
