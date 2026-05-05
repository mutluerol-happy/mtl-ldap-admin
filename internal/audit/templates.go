package audit

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"time"
)

// TemplateConfig yeni kullanıcı yaratırken uygulanacak preset.
type TemplateConfig struct {
	Description        string            `json:"description,omitempty"`
	Groups             []string          `json:"groups,omitempty"`             // CN'ler — kullanıcı yaratıldıktan sonra eklenecek
	DefaultEmailDomain string            `json:"defaultEmailDomain,omitempty"` // varsa: uid + "@" + domain
	PasswordStrategy   string            `json:"passwordStrategy,omitempty"`   // "manual" | "random"
	PasswordLength     int               `json:"passwordLength,omitempty"`
	ExtraAttributes    map[string]string `json:"extraAttributes,omitempty"` // ileride şema gezgini ile eşlenecek
}

type Template struct {
	Name      string         `json:"name"`
	Config    TemplateConfig `json:"config"`
	CreatedAt time.Time      `json:"createdAt"`
	UpdatedAt time.Time      `json:"updatedAt"`
}

// migrateTemplates audit migration ile birlikte çağrılır.
func migrateTemplates(db *sql.DB) error {
	_, err := db.Exec(`
CREATE TABLE IF NOT EXISTS templates (
	name TEXT PRIMARY KEY,
	config TEXT NOT NULL,
	created_at INTEGER NOT NULL,
	updated_at INTEGER NOT NULL
);`)
	return err
}

func (s *Store) ListTemplates() ([]Template, error) {
	rows, err := s.db.Query(`SELECT name, config, created_at, updated_at FROM templates ORDER BY name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Template{}
	for rows.Next() {
		var t Template
		var configJSON string
		var created, updated int64
		if err := rows.Scan(&t.Name, &configJSON, &created, &updated); err != nil {
			return nil, err
		}
		if err := json.Unmarshal([]byte(configJSON), &t.Config); err != nil {
			return nil, fmt.Errorf("template %s: %w", t.Name, err)
		}
		t.CreatedAt = time.UnixMilli(created).UTC()
		t.UpdatedAt = time.UnixMilli(updated).UTC()
		out = append(out, t)
	}
	return out, rows.Err()
}

func (s *Store) GetTemplate(name string) (*Template, error) {
	var t Template
	var configJSON string
	var created, updated int64
	err := s.db.QueryRow(
		`SELECT name, config, created_at, updated_at FROM templates WHERE name = ?`, name,
	).Scan(&t.Name, &configJSON, &created, &updated)
	if err == sql.ErrNoRows {
		return nil, fmt.Errorf("şablon bulunamadı: %s", name)
	}
	if err != nil {
		return nil, err
	}
	if err := json.Unmarshal([]byte(configJSON), &t.Config); err != nil {
		return nil, err
	}
	t.CreatedAt = time.UnixMilli(created).UTC()
	t.UpdatedAt = time.UnixMilli(updated).UTC()
	return &t, nil
}

func (s *Store) SaveTemplate(name string, config TemplateConfig) error {
	if name == "" {
		return fmt.Errorf("isim zorunlu")
	}
	configJSON, err := json.Marshal(config)
	if err != nil {
		return err
	}
	now := time.Now().UnixMilli()
	// upsert
	_, err = s.db.Exec(`
INSERT INTO templates (name, config, created_at, updated_at) VALUES (?, ?, ?, ?)
ON CONFLICT(name) DO UPDATE SET config = excluded.config, updated_at = excluded.updated_at`,
		name, string(configJSON), now, now)
	return err
}

func (s *Store) DeleteTemplate(name string) error {
	res, err := s.db.Exec(`DELETE FROM templates WHERE name = ?`, name)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return fmt.Errorf("şablon bulunamadı: %s", name)
	}
	return nil
}
