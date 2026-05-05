package audit

import (
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"time"
)

// migrateUserSecrets MFA, security questions ve reset tokens için tabloları kurar.
func migrateUserSecrets(db *sql.DB) error {
	_, err := db.Exec(`
CREATE TABLE IF NOT EXISTS mfa (
	uid TEXT PRIMARY KEY,
	secret TEXT NOT NULL,
	enabled INTEGER NOT NULL DEFAULT 0,
	enabled_at INTEGER,
	-- yedek kodlar virgüllü hash listesi (sha256 hex)
	backup_codes TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS security_questions (
	uid TEXT NOT NULL,
	idx INTEGER NOT NULL,
	question TEXT NOT NULL,
	answer_hash TEXT NOT NULL,
	created_at INTEGER NOT NULL,
	PRIMARY KEY (uid, idx)
);

CREATE TABLE IF NOT EXISTS reset_tokens (
	token_hash TEXT PRIMARY KEY,
	uid TEXT NOT NULL,
	method TEXT NOT NULL,         -- email | sms | questions
	created_at INTEGER NOT NULL,
	expires_at INTEGER NOT NULL,
	used_at INTEGER,
	requester_ip TEXT
);
CREATE INDEX IF NOT EXISTS idx_reset_uid ON reset_tokens(uid);
CREATE INDEX IF NOT EXISTS idx_reset_exp ON reset_tokens(expires_at);
`)
	return err
}

// ---- MFA ----

type MFARecord struct {
	UID         string    `json:"uid"`
	Enabled     bool      `json:"enabled"`
	EnabledAt   time.Time `json:"enabledAt,omitempty"`
	HasSecret   bool      `json:"hasSecret"` // setup başlatılmış ama tamamlanmamış olabilir
	BackupCodes int       `json:"backupCodesRemaining"`
	// secret asla JSON'a serialize edilmez
	secret       string
	backupHashes []string
}

// GetMFA kullanıcı için MFA kaydını getirir; yoksa nil, nil döner.
func (s *Store) GetMFA(uid string) (*MFARecord, error) {
	var r MFARecord
	var enabled int
	var enabledAt sql.NullInt64
	var backupCodes string
	err := s.db.QueryRow(
		`SELECT uid, secret, enabled, enabled_at, backup_codes FROM mfa WHERE uid = ?`,
		uid,
	).Scan(&r.UID, &r.secret, &enabled, &enabledAt, &backupCodes)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	r.Enabled = enabled == 1
	r.HasSecret = r.secret != ""
	if enabledAt.Valid {
		r.EnabledAt = time.UnixMilli(enabledAt.Int64).UTC()
	}
	if backupCodes != "" {
		r.backupHashes = strings.Split(backupCodes, ",")
	}
	r.BackupCodes = len(r.backupHashes)
	return &r, nil
}

// MFASecret raw secret döner — sadece MFA verifier için kullanılır.
func (r *MFARecord) Secret() string { return r.secret }

// SetMFASecret enroll başlangıcında secret'ı kaydeder; enabled hâlâ false.
func (s *Store) SetMFASecret(uid, secret string) error {
	_, err := s.db.Exec(`
INSERT INTO mfa (uid, secret, enabled) VALUES (?, ?, 0)
ON CONFLICT(uid) DO UPDATE SET secret = excluded.secret, enabled = 0, enabled_at = NULL, backup_codes = ''`,
		uid, secret)
	return err
}

// EnableMFA verify başarılıysa enabled=1 ve backup kodlarını set eder.
func (s *Store) EnableMFA(uid string, backupCodeHashes []string) error {
	_, err := s.db.Exec(
		`UPDATE mfa SET enabled = 1, enabled_at = ?, backup_codes = ? WHERE uid = ?`,
		time.Now().UnixMilli(), strings.Join(backupCodeHashes, ","), uid,
	)
	return err
}

func (s *Store) DisableMFA(uid string) error {
	_, err := s.db.Exec(`DELETE FROM mfa WHERE uid = ?`, uid)
	return err
}

// ConsumeBackupCode hash'i listede varsa siler ve true döner.
func (s *Store) ConsumeBackupCode(uid, codeHash string) (bool, error) {
	var raw string
	err := s.db.QueryRow(`SELECT backup_codes FROM mfa WHERE uid = ?`, uid).Scan(&raw)
	if err != nil {
		return false, err
	}
	codes := strings.Split(raw, ",")
	out := make([]string, 0, len(codes))
	found := false
	for _, c := range codes {
		if c == codeHash && !found {
			found = true
			continue
		}
		if c != "" {
			out = append(out, c)
		}
	}
	if !found {
		return false, nil
	}
	_, err = s.db.Exec(`UPDATE mfa SET backup_codes = ? WHERE uid = ?`,
		strings.Join(out, ","), uid)
	return err == nil, err
}

// ---- Security questions ----

type SecurityQuestion struct {
	Index    int    `json:"index"`
	Question string `json:"question"`
}

func (s *Store) ListSecurityQuestions(uid string) ([]SecurityQuestion, error) {
	rows, err := s.db.Query(
		`SELECT idx, question FROM security_questions WHERE uid = ? ORDER BY idx`, uid,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []SecurityQuestion{}
	for rows.Next() {
		var q SecurityQuestion
		if err := rows.Scan(&q.Index, &q.Question); err != nil {
			return nil, err
		}
		out = append(out, q)
	}
	return out, rows.Err()
}

// SetSecurityQuestions atomik olarak eski soruları siler ve yenilerini yazar.
// answers düz metin gelir — caller tarafından bcrypt hash'lenir.
type SecurityQuestionInput struct {
	Question   string
	AnswerHash string
}

func (s *Store) SetSecurityQuestions(uid string, qs []SecurityQuestionInput) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.Exec(`DELETE FROM security_questions WHERE uid = ?`, uid); err != nil {
		return err
	}
	now := time.Now().UnixMilli()
	for i, q := range qs {
		if _, err := tx.Exec(
			`INSERT INTO security_questions (uid, idx, question, answer_hash, created_at) VALUES (?, ?, ?, ?, ?)`,
			uid, i, q.Question, q.AnswerHash, now,
		); err != nil {
			return err
		}
	}
	return tx.Commit()
}

// GetSecurityQuestionHashes hash'leri döner — verify akışı için.
func (s *Store) GetSecurityQuestionHashes(uid string) ([]string, error) {
	rows, err := s.db.Query(
		`SELECT answer_hash FROM security_questions WHERE uid = ? ORDER BY idx`, uid,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []string{}
	for rows.Next() {
		var h string
		if err := rows.Scan(&h); err != nil {
			return nil, err
		}
		out = append(out, h)
	}
	return out, rows.Err()
}

// ---- Reset tokens ----

type ResetToken struct {
	UID    string
	Method string
}

// IssueResetToken tek-kullanımlık token üretir, hash'ini DB'ye yazar, raw token döner.
// ttl 0 ise 30 dakika.
func (s *Store) IssueResetToken(uid, method, ip string, ttl time.Duration) (string, error) {
	if ttl == 0 {
		ttl = 30 * time.Minute
	}
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return "", err
	}
	token := hex.EncodeToString(raw)
	hash := tokenHash(token)
	now := time.Now()
	_, err := s.db.Exec(
		`INSERT INTO reset_tokens (token_hash, uid, method, created_at, expires_at, requester_ip) VALUES (?, ?, ?, ?, ?, ?)`,
		hash, uid, method, now.UnixMilli(), now.Add(ttl).UnixMilli(), ip,
	)
	if err != nil {
		return "", err
	}
	return token, nil
}

// VerifyResetToken token'ı doğrular ve "kullanıldı" işaretler. Tek bir kez tüketilir.
func (s *Store) VerifyResetToken(token string) (*ResetToken, error) {
	hash := tokenHash(token)
	tx, err := s.db.Begin()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	var uid, method string
	var expires int64
	var usedAt sql.NullInt64
	err = tx.QueryRow(
		`SELECT uid, method, expires_at, used_at FROM reset_tokens WHERE token_hash = ?`, hash,
	).Scan(&uid, &method, &expires, &usedAt)
	if err == sql.ErrNoRows {
		return nil, errors.New("token geçersiz")
	}
	if err != nil {
		return nil, err
	}
	if usedAt.Valid {
		return nil, errors.New("token zaten kullanıldı")
	}
	if time.Now().UnixMilli() > expires {
		return nil, errors.New("token süresi dolmuş")
	}
	if _, err := tx.Exec(
		`UPDATE reset_tokens SET used_at = ? WHERE token_hash = ?`,
		time.Now().UnixMilli(), hash,
	); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return &ResetToken{UID: uid, Method: method}, nil
}

// CleanupExpiredTokens 24 saatten eski / süresi dolmuş token'ları siler.
func (s *Store) CleanupExpiredTokens() error {
	cutoff := time.Now().Add(-24 * time.Hour).UnixMilli()
	_, err := s.db.Exec(`DELETE FROM reset_tokens WHERE expires_at < ? OR used_at < ?`, cutoff, cutoff)
	return err
}

func tokenHash(t string) string {
	h := sha256.Sum256([]byte(t))
	return hex.EncodeToString(h[:])
}

// HashCode SHA-256 bir kodu hash'ler (yedek kod, telefon kodu vb.).
// Bcrypt değil çünkü bunlar kısa-ömürlü ve yüksek entropy'ye sahip.
func HashCode(code string) string {
	return tokenHash(code)
}

// EnsureMethodAllowed config'de izin verilen metodların listesinde mi kontrol eder.
func EnsureMethodAllowed(allowed []string, method string) error {
	for _, a := range allowed {
		if strings.EqualFold(a, method) {
			return nil
		}
	}
	return fmt.Errorf("yöntem desteklenmiyor: %s", method)
}
