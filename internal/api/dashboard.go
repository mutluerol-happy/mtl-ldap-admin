package api

import (
	"encoding/json"
	"net/http"
	"strconv"

	"github.com/mutluerol-happy/mtl-ldap-admin/internal/audit"
	"github.com/mutluerol-happy/mtl-ldap-admin/internal/auth"
)

// ---- Monitor ----

func (s *Server) handleMonitor(w http.ResponseWriter, r *http.Request) {
	info, err := s.ldap.Monitor()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, info)
}

// ---- Stats ----

func (s *Server) handleStats(w http.ResponseWriter, r *http.Request) {
	days, _ := strconv.Atoi(r.URL.Query().Get("days"))
	stats, err := s.audit.Stats(days)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, stats)
}

// ---- Webhooks ----

const (
	WebhookCreate audit.Action = "webhook.create"
	WebhookDelete audit.Action = "webhook.delete"
	WebhookTest   audit.Action = "webhook.test"
)

func (s *Server) handleListWebhooks(w http.ResponseWriter, r *http.Request) {
	hooks, err := s.audit.ListWebhooks()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": hooks, "count": len(hooks)})
}

func (s *Server) handleSaveWebhook(w http.ResponseWriter, r *http.Request) {
	actor := r.Context().Value(ctxUser).(*auth.Claims).UID
	ip := clientIP(r)

	var in audit.WebhookInput
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		writeErr(w, http.StatusBadRequest, "geçersiz JSON")
		return
	}
	hook, err := s.audit.SaveWebhook(in)
	if err != nil {
		s.auditLog(actor, WebhookCreate, in.Name, ip, audit.StatusFail, err.Error())
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	s.auditLog(actor, WebhookCreate, in.Name, ip, audit.StatusOK, "")
	writeJSON(w, http.StatusOK, hook)
}

func (s *Server) handleDeleteWebhook(w http.ResponseWriter, r *http.Request) {
	actor := r.Context().Value(ctxUser).(*auth.Claims).UID
	ip := clientIP(r)
	name := r.PathValue("name")
	if err := s.audit.DeleteWebhook(name); err != nil {
		s.auditLog(actor, WebhookDelete, name, ip, audit.StatusFail, err.Error())
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	s.auditLog(actor, WebhookDelete, name, ip, audit.StatusOK, "")
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleListDeliveries(w http.ResponseWriter, r *http.Request) {
	id, _ := strconv.ParseInt(r.PathValue("id"), 10, 64)
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	items, err := s.audit.ListDeliveries(id, limit)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items, "count": len(items)})
}

// handleTestWebhook bir test eventi tetikler — webhook gerçek event'lerden bağımsız olarak test edilebilir.
// Audit log'a webhook.test yazar; bu da kayıtlı webhook'un kendisi tarafından gönderiliyor.
func (s *Server) handleTestWebhook(w http.ResponseWriter, r *http.Request) {
	actor := r.Context().Value(ctxUser).(*auth.Claims).UID
	ip := clientIP(r)
	name := r.PathValue("name")
	s.auditLog(actor, WebhookTest, name, ip, audit.StatusOK, "manual test trigger")
	w.WriteHeader(http.StatusAccepted)
}

// ---- Replication (v0.9 placeholder) ----

// handleReplicationStatus replikasyon durumunu döner.
//
// v0.9: ikinci sunucu henüz hazır olmadığı için placeholder. UI bu endpoint'in
// `configured: false` yanıtını görüp "henüz yapılandırılmadı" sayfasını render eder.
//
// İleride: cn=Monitor altındaki replication sayaçlarını (contextCSN diff,
// olcSyncrepl entry'leri vs.) okuyup gerçek state döner. Backend interface'i
// değişmez, UI da değişmez; sadece bu fonksiyonun içi büyür.
func (s *Server) handleReplicationStatus(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"configured": false,
		"message":    "İkinci sunucu henüz yapılandırılmadı. cn=config altında syncrepl provider/consumer eklenince burası gerçek replication state'i gösterecek.",
		"providers":  []any{},
		"consumers":  []any{},
	})
}
