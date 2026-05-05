package sms

import (
	"bytes"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/mutluerol-happy/mtl-ldap-admin/internal/audit"
)

// DBSender DB'den SMSSettings okuyan generic HTTP gateway.
//
// Template syntax: {{phone}}, {{message}}, {{otp}}, {{uid}} her şey hem
// URLTemplate'te hem BodyTemplate'te placeholder olarak çalışır. URL-safe
// olması için phone trimlenir, message URL-encode edilmez (caller body'de
// ne istiyorsa onu yazsın — JSON ise JSON, form-encoded ise form-encoded).
//
// Provider örnekleri:
//
//	Twilio (form-encoded):
//	  Method: POST
//	  URL: https://api.twilio.com/2010-04-01/Accounts/AC.../Messages.json
//	  Body: To={{phone}}&From=+1234567890&Body={{message}}
//	  Content-Type: application/x-www-form-urlencoded
//	  Auth: Basic xxx (manuel header)
//
//	Netgsm (HTTP GET):
//	  Method: GET
//	  URL: https://api.netgsm.com.tr/sms/send/get?usercode=X&password=Y&gsmno={{phone}}&message={{message}}&msgheader=BAS
//	  Success: "00 "
//
//	Generic webhook (JSON):
//	  Method: POST
//	  URL: https://hooks.example.com/sms
//	  Body: {"to":"{{phone}}","text":"{{message}}"}
//	  Content-Type: application/json
type DBSender struct {
	store     *audit.Store
	masterKey []byte
}

func NewDBSender(store *audit.Store, masterKey []byte) *DBSender {
	return &DBSender{store: store, masterKey: masterKey}
}

func (d *DBSender) IsConfigured() bool {
	settings, err := d.store.GetSMSSettings()
	if err != nil {
		return false
	}
	return settings.Enabled && settings.URLTemplate != ""
}

// Send kullanıcıya SMS gönderir. caller `vars` map'i ile placeholder
// değerlerini geçer (`uid`, `otp` vs). Bu map'e ek olarak {{phone}} ve
// {{message}} otomatik dolurulur.
func (d *DBSender) Send(phone string, vars map[string]string) error {
	settings, err := d.store.GetSMSSettings()
	if err != nil {
		return err
	}
	if !settings.Enabled || settings.URLTemplate == "" {
		return errors.New("sms yapılandırılmamış (Settings → SMS)")
	}

	// Önce mesajı oluştur (placeholder dolu, raw — boşluk vs. olduğu gibi)
	allVars := map[string]string{}
	for k, v := range vars {
		allVars[k] = v
	}
	allVars["phone"] = strings.TrimSpace(phone)
	message := expandRaw(settings.MessageTemplate, allVars)
	allVars["message"] = message

	// URL template — placeholder'lar URL-encode edilir (boşluk, &, =, +).
	// Aksi halde "&" ile ayrılan query param'lara karışır, gateway URL'i
	// parse edemez.
	url := expandURL(settings.URLTemplate, allVars)
	method := strings.ToUpper(settings.Method)
	if method == "" {
		method = "POST"
	}

	var body io.Reader
	if method != "GET" && settings.BodyTemplate != "" {
		// Body template — kullanıcı JSON mı, form-urlencoded mi yazdığına
		// göre kendi escape'i yapmış olmalı. Raw expand yeterli.
		// (JSON template kullanıyorsa {{message}} içindeki " gibi karakterler
		// için kullanıcı template'i \"{{message}}\" yazmalı — burada
		// otomatik escape yapamayız çünkü context'i bilmiyoruz.)
		body = strings.NewReader(expandRaw(settings.BodyTemplate, allVars))
	}

	req, err := http.NewRequest(method, url, body)
	if err != nil {
		return err
	}
	if settings.ContentType != "" {
		req.Header.Set("Content-Type", settings.ContentType)
	} else if method != "GET" {
		req.Header.Set("Content-Type", "application/json")
	}
	if settings.AuthHeaderEncrypted != "" {
		auth, err := settings.PlaintextAuthHeader(d.masterKey)
		if err != nil {
			return fmt.Errorf("decrypt sms auth: %w", err)
		}
		if idx := strings.Index(auth, ":"); idx > 0 {
			req.Header.Set(strings.TrimSpace(auth[:idx]), strings.TrimSpace(auth[idx+1:]))
		} else {
			req.Header.Set("Authorization", strings.TrimSpace(auth))
		}
	}

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("sms http: %w", err)
	}
	defer resp.Body.Close()
	respBody, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))

	if settings.SuccessSubstring != "" {
		if !bytes.Contains(respBody, []byte(settings.SuccessSubstring)) {
			return fmt.Errorf("sms response başarı string'i içermiyor (HTTP %d): %s",
				resp.StatusCode, string(respBody))
		}
		return nil
	}
	if resp.StatusCode >= 400 {
		return fmt.Errorf("sms http %d: %s", resp.StatusCode, string(respBody))
	}
	return nil
}

// SendTest UI'daki "send test" butonu için.
// v0.10.2: gerçek akışta dolan {{link}} ve {{ttl}} placeholder'ları test'te
// de placeholder dolar — yoksa "MTL Password Reset code: (gecerli dk)" gibi
// boş/anlamsız mesaj çıkıyor.
func (d *DBSender) SendTest(phone string) error {
	return d.Send(phone, map[string]string{
		"otp":  "123456",
		"uid":  "test",
		"link": "https://test.example/reset?token=TEST",
		"ttl":  "30",
	})
}

// expandRaw "{{key}}" placeholder'larını vars[key] ile RAW olarak değiştirir.
// Body template'inde kullanılır (JSON/form-encoded vs). Bilinmeyen key'ler
// "" olarak silinir.
func expandRaw(tmpl string, vars map[string]string) string {
	out := tmpl
	for k, v := range vars {
		out = strings.ReplaceAll(out, "{{"+k+"}}", v)
	}
	for {
		i := strings.Index(out, "{{")
		if i < 0 {
			break
		}
		j := strings.Index(out[i:], "}}")
		if j < 0 {
			break
		}
		out = out[:i] + out[i+j+2:]
	}
	return out
}

// expandURL placeholder'ları URL-encode'layarak değiştirir. URL template'inde
// kullanılır. {{phone}}, {{message}} gibi değerler boşluk, "&", "+" içerebilir;
// bunların query string'i bozmaması için url.QueryEscape ile encode edilir.
//
// NOT: template'in URL kısmındaki "&", "=", "?" gibi yapısal karakterler
// dokunulmaz — sadece placeholder VALUE'su encode edilir. Bu yüzden expand
// yapmadan önce template'in kendisini parse etmiyoruz; sadece her {{k}}'yı
// QueryEscape(v) ile substitute ediyoruz.
func expandURL(tmpl string, vars map[string]string) string {
	out := tmpl
	for k, v := range vars {
		out = strings.ReplaceAll(out, "{{"+k+"}}", urlValueEscape(v))
	}
	for {
		i := strings.Index(out, "{{")
		if i < 0 {
			break
		}
		j := strings.Index(out[i:], "}}")
		if j < 0 {
			break
		}
		out = out[:i] + out[i+j+2:]
	}
	return out
}

// urlValueEscape query string parameter VALUE'ları için RFC 3986 uyumlu encode.
// net/url'un QueryEscape'i: boşluk → "+", non-ASCII → %xx, "&"/"="/"+" → %xx.
// IAS gateway de boşluk yerine "+" istiyor (script aynı şeyi yapıyor) —
// tam uyumlu.
func urlValueEscape(s string) string {
	return url.QueryEscape(s)
}
