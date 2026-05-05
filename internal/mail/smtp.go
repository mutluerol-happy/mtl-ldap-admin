package mail

import (
	"crypto/tls"
	"errors"
	"fmt"
	"net"
	"net/smtp"
	"strings"
	"time"

	"github.com/mutluerol-happy/mtl-ldap-admin/internal/config"
)

type Sender struct {
	cfg config.Config
}

func New(cfg *config.Config) *Sender {
	return &Sender{cfg: *cfg}
}

// IsConfigured SMTP gönderim için minimum config var mı?
func (s *Sender) IsConfigured() bool {
	return s.cfg.SMTPHost != "" && s.cfg.SMTPPort != 0 && s.cfg.SMTPFrom != ""
}

// Send tek bir alıcıya plain-text + HTML email gönderir.
// SMTPStartTLS=true ise STARTTLS yapar; aksi halde plain (yalnızca dev).
// SMTP servers genellikle 587'de STARTTLS, 465'te implicit TLS, 25'te plain ister.
func (s *Sender) Send(to, subject, textBody, htmlBody string) error {
	if !s.IsConfigured() {
		return errors.New("smtp yapılandırılmamış")
	}

	addr := fmt.Sprintf("%s:%d", s.cfg.SMTPHost, s.cfg.SMTPPort)
	boundary := fmt.Sprintf("mtl-ldap-admin-%d", time.Now().UnixNano())

	var sb strings.Builder
	fmt.Fprintf(&sb, "From: %s\r\n", s.cfg.SMTPFrom)
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
	from := extractEmailAddress(s.cfg.SMTPFrom)

	// Implicit TLS (port 465 gibi) için tls.Dial kullanmak gerekirdi;
	// pratikte STARTTLS daha yaygın.
	if s.cfg.SMTPStartTLS {
		return sendWithStartTLS(addr, s.cfg.SMTPHost, s.cfg.SMTPUser, s.cfg.SMTPPassword, from, []string{to}, msg)
	}
	// Plain (yalnız dev/local relay)
	var auth smtp.Auth
	if s.cfg.SMTPUser != "" {
		auth = smtp.PlainAuth("", s.cfg.SMTPUser, s.cfg.SMTPPassword, s.cfg.SMTPHost)
	}
	return smtp.SendMail(addr, auth, from, []string{to}, msg)
}

func sendWithStartTLS(addr, host, user, pass, from string, to []string, msg []byte) error {
	conn, err := net.DialTimeout("tcp", addr, 10*time.Second)
	if err != nil {
		return fmt.Errorf("smtp dial: %w", err)
	}
	c, err := smtp.NewClient(conn, host)
	if err != nil {
		conn.Close()
		return fmt.Errorf("smtp client: %w", err)
	}
	defer c.Quit()

	if ok, _ := c.Extension("STARTTLS"); ok {
		if err := c.StartTLS(&tls.Config{ServerName: host}); err != nil {
			return fmt.Errorf("starttls: %w", err)
		}
	}
	if user != "" {
		auth := smtp.PlainAuth("", user, pass, host)
		if err := c.Auth(auth); err != nil {
			return fmt.Errorf("smtp auth: %w", err)
		}
	}
	if err := c.Mail(from); err != nil {
		return err
	}
	for _, t := range to {
		if err := c.Rcpt(t); err != nil {
			return err
		}
	}
	w, err := c.Data()
	if err != nil {
		return err
	}
	if _, err := w.Write(msg); err != nil {
		return err
	}
	return w.Close()
}

// extractEmailAddress "Foo <foo@bar.com>" → "foo@bar.com"; gerisi olduğu gibi.
func extractEmailAddress(s string) string {
	if i := strings.LastIndex(s, "<"); i >= 0 {
		if j := strings.LastIndex(s, ">"); j > i {
			return s[i+1 : j]
		}
	}
	return s
}
