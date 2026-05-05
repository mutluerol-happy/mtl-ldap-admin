package sms

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/mutluerol-happy/mtl-ldap-admin/internal/config"
)

// Sender SMS gönderim arayüzü.
type Sender interface {
	IsConfigured() bool
	Send(to, message string) error
}

// New config'e göre uygun provider'ı kurar; provider seçili değilse no-op döner.
func New(cfg *config.Config) Sender {
	switch strings.ToLower(cfg.SMSProvider) {
	case "webhook":
		return &webhookSender{url: cfg.SMSWebhookURL, auth: cfg.SMSAuthHeader}
	case "twilio":
		return &twilioSender{sid: cfg.TwilioSID, token: cfg.TwilioToken, from: cfg.TwilioFrom}
	default:
		return noop{}
	}
}

// noop hiçbir şey yapmaz; "configured" döner false.
type noop struct{}

func (noop) IsConfigured() bool     { return false }
func (noop) Send(_, _ string) error { return errors.New("sms provider yapılandırılmamış") }

// ---- Webhook provider ----
//
// POST {{webhook_url}} body: {"to":"+90...","message":"...."}
// İsteğe bağlı SMS_AUTH_HEADER (örn "Bearer xxx") Authorization header'ı olarak gider.

type webhookSender struct {
	url  string
	auth string
}

func (w *webhookSender) IsConfigured() bool { return w.url != "" }

func (w *webhookSender) Send(to, message string) error {
	if !w.IsConfigured() {
		return errors.New("webhook URL yapılandırılmamış")
	}
	body, _ := json.Marshal(map[string]string{"to": to, "message": message})
	req, err := http.NewRequest("POST", w.url, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	if w.auth != "" {
		req.Header.Set("Authorization", w.auth)
	}
	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("sms webhook: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		buf, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return fmt.Errorf("sms webhook %d: %s", resp.StatusCode, string(buf))
	}
	return nil
}

// ---- Twilio provider ----
//
// POST https://api.twilio.com/2010-04-01/Accounts/{SID}/Messages.json
// form-encoded: To, From, Body. Basic auth: SID + AuthToken.

type twilioSender struct {
	sid, token, from string
}

func (t *twilioSender) IsConfigured() bool {
	return t.sid != "" && t.token != "" && t.from != ""
}

func (t *twilioSender) Send(to, message string) error {
	if !t.IsConfigured() {
		return errors.New("twilio yapılandırılmamış")
	}
	endpoint := fmt.Sprintf("https://api.twilio.com/2010-04-01/Accounts/%s/Messages.json", t.sid)
	form := url.Values{}
	form.Set("To", to)
	form.Set("From", t.from)
	form.Set("Body", message)

	req, err := http.NewRequest("POST", endpoint, strings.NewReader(form.Encode()))
	if err != nil {
		return err
	}
	req.SetBasicAuth(t.sid, t.token)
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("twilio: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		buf, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return fmt.Errorf("twilio %d: %s", resp.StatusCode, string(buf))
	}
	return nil
}
