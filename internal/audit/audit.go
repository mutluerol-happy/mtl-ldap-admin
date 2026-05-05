package audit

import (
	"database/sql"
	"fmt"
	"time"

	_ "modernc.org/sqlite"
)

// Action audit log'unda yapılan işlemin türü.
type Action string

const (
	Login             Action = "auth.login"
	LoginFail         Action = "auth.login.fail"
	LoginRateLimit    Action = "auth.login.ratelimited"
	PasswordChange    Action = "password.change.self"
	UserCreate        Action = "user.create"
	UserUpdate        Action = "user.update"
	UserDelete        Action = "user.delete"
	UserPasswordReset Action = "user.password.reset"
	UserUnlock        Action = "user.unlock"
	GroupCreate       Action = "group.create"
	GroupDelete       Action = "group.delete"
	GroupAddMember    Action = "group.member.add"
	GroupRemoveMember Action = "group.member.remove"
	LDIFExport        Action = "ldif.export"
	LDIFImport        Action = "ldif.import"
	BulkUserCreate    Action = "bulk.user.create"
	BulkUserDelete    Action = "bulk.user.delete"
	BulkGroupAdd      Action = "bulk.group.add"
	BulkGroupRemove   Action = "bulk.group.remove"
	BulkPasswordReset Action = "bulk.password.reset"
	TemplateCreate    Action = "template.create"
	TemplateUpdate    Action = "template.update"
	TemplateDelete    Action = "template.delete"
	TemplateApply     Action = "template.apply"

	// Self-service
	SelfResetRequest Action = "password.reset.request"
	SelfResetVerify  Action = "password.reset.verify"
	SelfResetSuccess Action = "password.reset.success"
	SelfResetFail    Action = "password.reset.fail"

	// Security questions
	SecurityQuestionsSet Action = "self.security_questions.set"

	// MFA
	MFAEnroll       Action = "self.mfa.enroll"
	MFAEnable       Action = "self.mfa.enable"
	MFADisable      Action = "self.mfa.disable"
	MFADisableAdmin Action = "user.mfa.disable" // admin tarafından
	MFAChallenge    Action = "auth.mfa.challenge"
	MFAFail         Action = "auth.mfa.fail"

	// v0.10 — settings & ops
	SettingsUpdate   Action = "settings.update"
	SMTPTest         Action = "smtp.test"
	SMSTest          Action = "sms.test"
	LDAPSCertUpload  Action = "ldaps.cert.upload"
	LDAPSConfigApply Action = "ldaps.config.apply"
)

type Status string

const (
	StatusOK   Status = "ok"
	StatusFail Status = "fail"
)

type Entry struct {
	ID        int64     `json:"id"`
	Timestamp time.Time `json:"timestamp"`
	Actor     string    `json:"actor"`
	Action    string    `json:"action"`
	Target    string    `json:"target,omitempty"`
	IP        string    `json:"ip,omitempty"`
	Status    string    `json:"status"`
	Details   string    `json:"details,omitempty"`
}

type Store struct {
	db         *sql.DB
	dispatcher func(Entry) // opsiyonel; webhook fan-out için. nil ise no-op.
}

func Open(path string) (*Store, error) {
	db, err := sql.Open("sqlite", path+"?_journal_mode=WAL&_busy_timeout=5000")
	if err != nil {
		return nil, fmt.Errorf("open sqlite: %w", err)
	}
	db.SetMaxOpenConns(4)
	if _, err := db.Exec(`
CREATE TABLE IF NOT EXISTS audit (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	ts INTEGER NOT NULL,
	actor TEXT NOT NULL,
	action TEXT NOT NULL,
	target TEXT,
	ip TEXT,
	status TEXT NOT NULL,
	details TEXT
);
CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit(ts DESC);
CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit(actor);
CREATE INDEX IF NOT EXISTS idx_audit_action ON audit(action);
`); err != nil {
		return nil, fmt.Errorf("migrate audit: %w", err)
	}
	if err := migrateTemplates(db); err != nil {
		return nil, fmt.Errorf("migrate templates: %w", err)
	}
	if err := migrateUserSecrets(db); err != nil {
		return nil, fmt.Errorf("migrate user secrets: %w", err)
	}
	if err := migrateWebhooks(db); err != nil {
		return nil, fmt.Errorf("migrate webhooks: %w", err)
	}
	if err := migrateSettings(db); err != nil {
		return nil, fmt.Errorf("migrate settings: %w", err)
	}
	return &Store{db: db}, nil
}

func (s *Store) Close() error {
	return s.db.Close()
}

// Log audit log girdisi yazar. Hatalar ihmal edilir (audit log uygulamayı kıramaz).
func (s *Store) Log(actor string, action Action, target, ip string, status Status, details string) {
	if s == nil {
		return
	}
	now := time.Now()
	_, _ = s.db.Exec(
		`INSERT INTO audit (ts, actor, action, target, ip, status, details) VALUES (?, ?, ?, ?, ?, ?, ?)`,
		now.UnixMilli(), actor, string(action), target, ip, string(status), details,
	)
	if s.dispatcher != nil {
		// Async — webhook ağ bekleyişi audit hot path'ini bloklamaz.
		go s.dispatcher(Entry{
			Timestamp: now.UTC(), Actor: actor, Action: string(action),
			Target: target, IP: ip, Status: string(status), Details: details,
		})
	}
}

// SetDispatcher webhook fan-out fonksiyonunu kaydeder. main.go'dan çağrılır.
func (s *Store) SetDispatcher(fn func(Entry)) {
	s.dispatcher = fn
}

type ListOpts struct {
	Limit  int
	Offset int
	Actor  string
	Action string
	Status string
}

type ListResult struct {
	Items []Entry `json:"items"`
	Total int     `json:"total"`
}

func (s *Store) List(opts ListOpts) (*ListResult, error) {
	if opts.Limit <= 0 {
		opts.Limit = 50
	}
	if opts.Limit > 500 {
		opts.Limit = 500
	}

	where := "WHERE 1=1"
	args := []any{}
	if opts.Actor != "" {
		where += " AND actor = ?"
		args = append(args, opts.Actor)
	}
	if opts.Action != "" {
		where += " AND action = ?"
		args = append(args, opts.Action)
	}
	if opts.Status != "" {
		where += " AND status = ?"
		args = append(args, opts.Status)
	}

	var total int
	if err := s.db.QueryRow("SELECT COUNT(*) FROM audit "+where, args...).Scan(&total); err != nil {
		return nil, err
	}

	args = append(args, opts.Limit, opts.Offset)
	rows, err := s.db.Query(
		"SELECT id, ts, actor, action, target, ip, status, details FROM audit "+where+" ORDER BY id DESC LIMIT ? OFFSET ?",
		args...,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []Entry{}
	for rows.Next() {
		var e Entry
		var ts int64
		var target, ip, details sql.NullString
		if err := rows.Scan(&e.ID, &ts, &e.Actor, &e.Action, &target, &ip, &e.Status, &details); err != nil {
			return nil, err
		}
		e.Timestamp = time.UnixMilli(ts).UTC()
		e.Target = target.String
		e.IP = ip.String
		e.Details = details.String
		out = append(out, e)
	}
	return &ListResult{Items: out, Total: total}, rows.Err()
}
