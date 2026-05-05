package webhooks

import (
	"bytes"
	"context"
	"io"
	"log/slog"
	"net/http"
	"time"

	"github.com/mutluerol-happy/mtl-ldap-admin/internal/audit"
)

// Dispatcher audit entry'lerini eşleşen webhook'lara gönderir.
// Senkron çağrılmamalı — audit.Store.SetDispatcher tarafından goroutine içinde tetiklenir.
type Dispatcher struct {
	store  *audit.Store
	client *http.Client
}

func New(store *audit.Store) *Dispatcher {
	return &Dispatcher{
		store:  store,
		client: &http.Client{Timeout: 10 * time.Second},
	}
}

// Dispatch entry'ye eşleşen tüm enabled webhook'ları gönderir.
// Her birine 1 retry; sonra delivery DB'ye yazılır.
func (d *Dispatcher) Dispatch(e audit.Entry) {
	hooks, err := d.store.ListEnabledWebhooksFor(e.Action)
	if err != nil {
		slog.Warn("webhook list failed", "err", err)
		return
	}
	for _, h := range hooks {
		go d.deliverOne(h, e)
	}
}

func (d *Dispatcher) deliverOne(h audit.Webhook, e audit.Entry) {
	body, contentType, err := audit.FormatPayload(h.Kind, e)
	if err != nil {
		d.store.RecordDelivery(h.ID, e.Action, "failed", 0, "format: "+err.Error())
		return
	}
	sig := audit.SignPayload(body, h.Secret)

	var lastErr string
	var lastStatus int

	// 2 deneme: ilk başarısızsa 1 sn sonra tekrar
	for attempt := 0; attempt < 2; attempt++ {
		if attempt > 0 {
			time.Sleep(time.Second)
		}
		ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
		req, err := http.NewRequestWithContext(ctx, "POST", h.URL, bytes.NewReader(body))
		if err != nil {
			cancel()
			lastErr = err.Error()
			continue
		}
		req.Header.Set("Content-Type", contentType)
		req.Header.Set("User-Agent", "mtl-ldap-admin-webhook/1.0")
		if sig != "" {
			req.Header.Set("X-MTL-Signature", "sha256="+sig)
		}
		resp, err := d.client.Do(req)
		cancel()
		if err != nil {
			lastErr = err.Error()
			continue
		}
		_, _ = io.Copy(io.Discard, resp.Body)
		resp.Body.Close()
		lastStatus = resp.StatusCode
		if resp.StatusCode < 400 {
			d.store.RecordDelivery(h.ID, e.Action, "ok", resp.StatusCode, "")
			return
		}
		lastErr = http.StatusText(resp.StatusCode)
	}
	d.store.RecordDelivery(h.ID, e.Action, "failed", lastStatus, lastErr)
}
