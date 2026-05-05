package mail

import (
	"errors"
	"fmt"
	"net/smtp"
	"strings"
	"time"

	"github.com/mutluerol-happy/mtl-ldap-admin/internal/audit"
)

// DBSender mevcut Sender'ın DB-backed versiyonu. Her Send() çağrısında
// audit.Store'dan SMTP ayarını okur — UI'dan ayar değişince restart gerekmez.
//
// Tasarım: cfg dosyasındaki SMTP* değerleri DB'de bir şey yoksa fallback olarak
// kullanılır (.env-only setup hala çalışır).
type DBSender struct {
	store     *audit.Store
	masterKey []byte // JWTSecret — encryption için derive edilir
	// Fallback values from .env (may be empty)
	fallbackHost     string
	fallbackPort     int
	fallbackUser     string
	fallbackPassword string
	fallbackFrom     string
	fallbackStartTLS bool
}

func NewDBSender(store *audit.Store, masterKey []byte,
	fbHost string, fbPort int, fbUser, fbPass, fbFrom string, fbStartTLS bool) *DBSender {
	return &DBSender{
		store: store, masterKey: masterKey,
		fallbackHost: fbHost, fallbackPort: fbPort,
		fallbackUser: fbUser, fallbackPassword: fbPass,
		fallbackFrom: fbFrom, fallbackStartTLS: fbStartTLS,
	}
}

// resolved DB veya .env'den effective config'i döner.
type resolved struct {
	host     string
	port     int
	user     string
	password string
	from     string
	startTLS bool
	enabled  bool
}

func (d *DBSender) resolve() (*resolved, error) {
	settings, err := d.store.GetSMTPSettings(d.masterKey)
	if err != nil {
		return nil, err
	}
	r := &resolved{
		host: d.fallbackHost, port: d.fallbackPort,
		user: d.fallbackUser, password: d.fallbackPassword,
		from: d.fallbackFrom, startTLS: d.fallbackStartTLS,
		// .env-only setup için: fallback dolu ise enabled say
		enabled: d.fallbackHost != "" && d.fallbackFrom != "",
	}
	// DB ayarı varsa override
	if settings.Host != "" {
		r.host = settings.Host
		r.enabled = settings.Enabled
	}
	if settings.Port != 0 {
		r.port = settings.Port
	}
	if settings.Username != "" {
		r.user = settings.Username
	}
	if settings.From != "" {
		r.from = settings.From
	}
	// startTLS DB'de explicit set edildiğinde override
	if settings.Host != "" {
		r.startTLS = settings.StartTLS
	}
	if settings.PasswordEncrypted != "" {
		pw, err := settings.PlaintextPassword(d.masterKey)
		if err != nil {
			return nil, fmt.Errorf("decrypt smtp password: %w", err)
		}
		r.password = pw
	}
	return r, nil
}

func (d *DBSender) IsConfigured() bool {
	r, err := d.resolve()
	if err != nil {
		return false
	}
	return r.enabled && r.host != "" && r.from != ""
}

// Send DB-backed mailer ile gönderir.
func (d *DBSender) Send(to, subject, textBody, htmlBody string) error {
	r, err := d.resolve()
	if err != nil {
		return err
	}
	if !r.enabled || r.host == "" || r.from == "" {
		return errors.New("smtp yapılandırılmamış (Settings → SMTP)")
	}
	addr := fmt.Sprintf("%s:%d", r.host, r.port)
	boundary := fmt.Sprintf("mtl-ldap-admin-%d", time.Now().UnixNano())

	var sb strings.Builder
	fmt.Fprintf(&sb, "From: %s\r\n", r.from)
	fmt.Fprintf(&sb, "To: %s\r\n", to)
	fmt.Fprintf(&sb, "Subject: %s\r\n", subject)
	fmt.Fprintf(&sb, "MIME-Version: 1.0\r\n")
	fmt.Fprintf(&sb, "Content-Type: multipart/alternative; boundary=\"%s\"\r\n", boundary)
	fmt.Fprintf(&sb, "Date: %s\r\n", time.Now().Format(time.RFC1123Z))
	sb.WriteString("\r\n")

	fmt.Fprintf(&sb, "--%s\r\n", boundary)
	sb.WriteString("Content-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: 8bit\r\n\r\n")
	sb.WriteString(textBody)
	sb.WriteString("\r\n")

	fmt.Fprintf(&sb, "--%s\r\n", boundary)
	sb.WriteString("Content-Type: text/html; charset=utf-8\r\nContent-Transfer-Encoding: 8bit\r\n\r\n")
	sb.WriteString(htmlBody)
	sb.WriteString("\r\n")

	fmt.Fprintf(&sb, "--%s--\r\n", boundary)
	msg := []byte(sb.String())
	from := extractEmailAddress(r.from)

	if r.startTLS {
		return sendWithStartTLS(addr, r.host, r.user, r.password, from, []string{to}, msg)
	}
	var auth smtp.Auth
	if r.user != "" {
		auth = smtp.PlainAuth("", r.user, r.password, r.host)
	}
	return smtp.SendMail(addr, auth, from, []string{to}, msg)
}

// SendTest UI'daki "send test" butonu için. Gerçek reset akışından bağımsız;
// admin'in kendi mail'ine gider.
func (d *DBSender) SendTest(to string) error {
	return d.Send(
		to,
		"MTL LDAP Admin — SMTP test",
		"This is a test message from MTL LDAP Admin.\nIf you can read this, SMTP is working.",
		`<p>This is a test message from <strong>MTL LDAP Admin</strong>.</p><p>If you can read this, SMTP is working.</p>`,
	)
}
