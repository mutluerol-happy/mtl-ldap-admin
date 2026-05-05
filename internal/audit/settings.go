package audit

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
)

// settings tablosu key/value formatında app-wide ayarları tutar.
//
// Tasarım kararları:
//   - JSON value (esnek schema; SMTPSettings/SMSSettings/LDAPSStatus farklı şekiller)
//   - secret_keys text liste — bu key'ler encrypt'leyerek saklanmalı (parolalar vs.)
//   - Encryption: AES-GCM, key = HKDF(JWTSecret, "settings-aead-v1") — JWTSecret
//     döndüğünde tüm secret'lar invalidate (geri çevrilebilir; v1 prefix ile
//     formatın değişmesine izin verilir)
//
// Şu anki key'ler:
//   "smtp"          → SMTP yapılandırması (encrypt: password)
//   "sms"           → SMS yapılandırması (encrypt: authValue + body template)
//   "ldaps"         → LDAPS durum/cert path'leri (no secret)
//   "password_reset" → enabled methods (questions/email/sms)

func migrateSettings(db *sql.DB) error {
	_, err := db.Exec(`
CREATE TABLE IF NOT EXISTS settings (
	key TEXT PRIMARY KEY,
	value TEXT NOT NULL,
	updated_at INTEGER NOT NULL
);
`)
	return err
}

// SetSecret AES-GCM ile encrypt'leyip base64 olarak döndürür. Key'in MAC'i
// "AEAD-v1:" prefix'iyle saklanır; format değişirse forward-compat için.
func encryptSecret(plaintext string, masterKey []byte) (string, error) {
	if len(masterKey) == 0 {
		return "", fmt.Errorf("master key boş")
	}
	// HKDF benzeri: SHA-256(masterKey || "settings-aead-v1") ilk 32 byte → AES-256 key
	h := hmac.New(sha256.New, masterKey)
	h.Write([]byte("settings-aead-v1"))
	key := h.Sum(nil)[:32]

	block, err := aes.NewCipher(key)
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return "", err
	}
	ct := gcm.Seal(nonce, nonce, []byte(plaintext), nil)
	return "AEAD-v1:" + base64.StdEncoding.EncodeToString(ct), nil
}

func decryptSecret(encoded string, masterKey []byte) (string, error) {
	if encoded == "" {
		return "", nil
	}
	const prefix = "AEAD-v1:"
	if len(encoded) < len(prefix) || encoded[:len(prefix)] != prefix {
		return "", fmt.Errorf("desteklenmeyen secret format")
	}
	raw, err := base64.StdEncoding.DecodeString(encoded[len(prefix):])
	if err != nil {
		return "", err
	}
	h := hmac.New(sha256.New, masterKey)
	h.Write([]byte("settings-aead-v1"))
	key := h.Sum(nil)[:32]
	block, err := aes.NewCipher(key)
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	if len(raw) < gcm.NonceSize() {
		return "", fmt.Errorf("ciphertext kısa")
	}
	nonce, ct := raw[:gcm.NonceSize()], raw[gcm.NonceSize():]
	pt, err := gcm.Open(nil, nonce, ct, nil)
	if err != nil {
		return "", err
	}
	return string(pt), nil
}

// SetSetting JSON value'yu kaydeder. Caller secret alanları zaten
// encryptSecret ile maskelemiş olmalı.
func (s *Store) SetSetting(key string, value any) error {
	raw, err := json.Marshal(value)
	if err != nil {
		return err
	}
	_, err = s.db.Exec(
		`INSERT INTO settings (key, value, updated_at) VALUES (?, ?, strftime('%s','now')*1000)
		 ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`,
		key, string(raw),
	)
	return err
}

// GetSetting JSON value'yu out parametresine decode eder. Bulamazsa nil err
// + zero value (caller default ile başlatmalı).
func (s *Store) GetSetting(key string, out any) (bool, error) {
	var raw string
	err := s.db.QueryRow(`SELECT value FROM settings WHERE key = ?`, key).Scan(&raw)
	if err == sql.ErrNoRows {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return true, json.Unmarshal([]byte(raw), out)
}

// SMTPSettings UI'dan gelen ve DB'ye yazılan struct.
// Password encrypt edilmiş halde saklanır; "—" ya da boş gelmesi
// "değiştirme, mevcut değeri koru" anlamı taşır (UI'da password alanı tipik
// olarak boş gösterilir, kullanıcı sadece değiştirmek isterse doldurur).
type SMTPSettings struct {
	Enabled  bool   `json:"enabled"`
	Host     string `json:"host"`
	Port     int    `json:"port"`
	Username string `json:"username"`
	// Password JSON serialize edilirken encrypted halde — UI'a gönderilirken
	// "" olarak maskelenir (HasPassword flag'iyle bilgi verilir).
	PasswordEncrypted string `json:"-"`
	From              string `json:"from"`
	StartTLS          bool   `json:"startTLS"`
	// Reply-to opsiyonel — boşsa From kullanılır
	ReplyTo string `json:"replyTo,omitempty"`
}

// SMTPSettingsView UI'a gösterilen güvenli (passwordsuz) şekil.
type SMTPSettingsView struct {
	Enabled     bool   `json:"enabled"`
	Host        string `json:"host"`
	Port        int    `json:"port"`
	Username    string `json:"username"`
	HasPassword bool   `json:"hasPassword"`
	From        string `json:"from"`
	ReplyTo     string `json:"replyTo,omitempty"`
	StartTLS    bool   `json:"startTLS"`
}

func (s *Store) GetSMTPSettings(masterKey []byte) (*SMTPSettings, error) {
	var raw struct {
		Enabled           bool   `json:"enabled"`
		Host              string `json:"host"`
		Port              int    `json:"port"`
		Username          string `json:"username"`
		PasswordEncrypted string `json:"passwordEncrypted"`
		From              string `json:"from"`
		ReplyTo           string `json:"replyTo,omitempty"`
		StartTLS          bool   `json:"startTLS"`
	}
	found, err := s.GetSetting("smtp", &raw)
	if err != nil {
		return nil, err
	}
	if !found {
		return &SMTPSettings{Port: 587, StartTLS: true}, nil
	}
	return &SMTPSettings{
		Enabled:           raw.Enabled,
		Host:              raw.Host,
		Port:              raw.Port,
		Username:          raw.Username,
		PasswordEncrypted: raw.PasswordEncrypted,
		From:              raw.From,
		ReplyTo:           raw.ReplyTo,
		StartTLS:          raw.StartTLS,
	}, nil
}

func (s *Store) SetSMTPSettings(in *SMTPSettings) error {
	// Persist edilirken PasswordEncrypted alanını da JSON'a yaz; struct tag "-"
	// olduğu için manuel map'e çeviriyoruz.
	return s.SetSetting("smtp", map[string]any{
		"enabled":           in.Enabled,
		"host":              in.Host,
		"port":              in.Port,
		"username":          in.Username,
		"passwordEncrypted": in.PasswordEncrypted,
		"from":              in.From,
		"replyTo":           in.ReplyTo,
		"startTLS":          in.StartTLS,
	})
}

// PlaintextPassword AES-GCM decrypt'leyip string döndürür.
func (s *SMTPSettings) PlaintextPassword(masterKey []byte) (string, error) {
	if s.PasswordEncrypted == "" {
		return "", nil
	}
	return decryptSecret(s.PasswordEncrypted, masterKey)
}

func (s *SMTPSettings) View() *SMTPSettingsView {
	return &SMTPSettingsView{
		Enabled:     s.Enabled,
		Host:        s.Host,
		Port:        s.Port,
		Username:    s.Username,
		HasPassword: s.PasswordEncrypted != "",
		From:        s.From,
		ReplyTo:     s.ReplyTo,
		StartTLS:    s.StartTLS,
	}
}

// SMSSettings generic HTTP SMS gateway. Sağlayıcı bağımsız.
//
// İşleyiş: kullanıcı UI'da template'i ve auth bilgisini girer. Send sırasında:
//  1. URLTemplate'teki {{phone}}, {{message}}, {{otp}} placeholder'ları replace edilir
//  2. BodyTemplate aynı şekilde — JSON body için
//  3. Method (GET/POST) kullanılır
//  4. AuthHeader varsa request'e eklenir (örn. "Authorization: Bearer xxx",
//     veya Basic Auth)
//  5. Yanıt SuccessSubstring içeriyorsa OK; yoksa fail
//
// Bu generic yapı Twilio/Netgsm/Vonage/Verimor/Nexmo hepsiyle uyumlu — sadece
// template farklı.
type SMSSettings struct {
	Enabled      bool   `json:"enabled"`
	Method       string `json:"method"` // "GET" | "POST"
	URLTemplate  string `json:"urlTemplate"`
	BodyTemplate string `json:"bodyTemplate,omitempty"` // POST için body
	ContentType  string `json:"contentType,omitempty"`  // varsayılan "application/json"
	// AuthHeader: "Authorization: Bearer xxx" gibi tek bir header. Encrypt'lenir.
	AuthHeaderEncrypted string `json:"-"`
	// Response body bu substring'i içeriyorsa OK; boşsa HTTP 2xx yeterli.
	SuccessSubstring string `json:"successSubstring,omitempty"`
	// MessageTemplate: SMS body içeriği. Default "Reset code: {{otp}}"
	MessageTemplate string `json:"messageTemplate"`
}

type SMSSettingsView struct {
	Enabled          bool   `json:"enabled"`
	Method           string `json:"method"`
	URLTemplate      string `json:"urlTemplate"`
	BodyTemplate     string `json:"bodyTemplate,omitempty"`
	ContentType      string `json:"contentType,omitempty"`
	HasAuthHeader    bool   `json:"hasAuthHeader"`
	SuccessSubstring string `json:"successSubstring,omitempty"`
	MessageTemplate  string `json:"messageTemplate"`
}

func (s *Store) GetSMSSettings() (*SMSSettings, error) {
	var raw struct {
		Enabled             bool   `json:"enabled"`
		Method              string `json:"method"`
		URLTemplate         string `json:"urlTemplate"`
		BodyTemplate        string `json:"bodyTemplate,omitempty"`
		ContentType         string `json:"contentType,omitempty"`
		AuthHeaderEncrypted string `json:"authHeaderEncrypted"`
		SuccessSubstring    string `json:"successSubstring,omitempty"`
		MessageTemplate     string `json:"messageTemplate"`
	}
	found, err := s.GetSetting("sms", &raw)
	if err != nil {
		return nil, err
	}
	if !found {
		return &SMSSettings{
			Method:          "POST",
			ContentType:     "application/json",
			MessageTemplate: "MTL Password Reset code: {{otp}} (valid 10min)",
		}, nil
	}
	return &SMSSettings{
		Enabled:             raw.Enabled,
		Method:              raw.Method,
		URLTemplate:         raw.URLTemplate,
		BodyTemplate:        raw.BodyTemplate,
		ContentType:         raw.ContentType,
		AuthHeaderEncrypted: raw.AuthHeaderEncrypted,
		SuccessSubstring:    raw.SuccessSubstring,
		MessageTemplate:     raw.MessageTemplate,
	}, nil
}

func (s *Store) SetSMSSettings(in *SMSSettings) error {
	return s.SetSetting("sms", map[string]any{
		"enabled":             in.Enabled,
		"method":              in.Method,
		"urlTemplate":         in.URLTemplate,
		"bodyTemplate":        in.BodyTemplate,
		"contentType":         in.ContentType,
		"authHeaderEncrypted": in.AuthHeaderEncrypted,
		"successSubstring":    in.SuccessSubstring,
		"messageTemplate":     in.MessageTemplate,
	})
}

func (s *SMSSettings) PlaintextAuthHeader(masterKey []byte) (string, error) {
	if s.AuthHeaderEncrypted == "" {
		return "", nil
	}
	return decryptSecret(s.AuthHeaderEncrypted, masterKey)
}

func (s *SMSSettings) View() *SMSSettingsView {
	return &SMSSettingsView{
		Enabled:          s.Enabled,
		Method:           s.Method,
		URLTemplate:      s.URLTemplate,
		BodyTemplate:     s.BodyTemplate,
		ContentType:      s.ContentType,
		HasAuthHeader:    s.AuthHeaderEncrypted != "",
		SuccessSubstring: s.SuccessSubstring,
		MessageTemplate:  s.MessageTemplate,
	}
}

// EncryptSecret dış kullanım için (handler'lardan çağrılır).
func EncryptSecret(plaintext string, masterKey []byte) (string, error) {
	return encryptSecret(plaintext, masterKey)
}

// LDAPSStatus UI'a gösterilen LDAPS durumu. Cert dosyaları /etc/mtl-ldap-admin/ssl/
// altında saklanır (writable path). cn=config'e yazma sırasında bu yollar
// olcTLS* attribute'larına gider.
type LDAPSStatus struct {
	Enabled        bool   `json:"enabled"`  // slapd reload sonrası aktif mi
	CertPath       string `json:"certPath"` // /etc/mtl-ldap-admin/ssl/server.crt
	KeyPath        string `json:"keyPath"`  // /etc/mtl-ldap-admin/ssl/server.key
	CACertPath     string `json:"caCertPath,omitempty"`
	CertSubject    string `json:"certSubject,omitempty"`
	CertIssuer     string `json:"certIssuer,omitempty"`
	CertNotBefore  string `json:"certNotBefore,omitempty"`
	CertNotAfter   string `json:"certNotAfter,omitempty"`
	UploadedAt     int64  `json:"uploadedAt,omitempty"` // unix ms
	LastApplyError string `json:"lastApplyError,omitempty"`
}

func (s *Store) GetLDAPSStatus() (*LDAPSStatus, error) {
	out := &LDAPSStatus{}
	_, err := s.GetSetting("ldaps", out)
	return out, err
}

func (s *Store) SetLDAPSStatus(in *LDAPSStatus) error {
	return s.SetSetting("ldaps", in)
}
