package extaudit

import (
	"fmt"
	"strings"
	"sync"
	"time"

	goldap "github.com/go-ldap/ldap/v3"
	"github.com/mutluerol-happy/mtl-ldap-admin/internal/config"
)

// ExternalAudit slapd `cn=accesslog` overlay'ini okuyarak mtl-ldap-admin dışı LDAP
// operasyonlarını izler. Sonuç dashboard sayaçlarına ve audit sayfasındaki
// "external" filter'ına gider.
//
// Kapsam (Batch 2 / v0.10):
//   - Sayım (toplam ops, write ops, son 24sa) — dashboard counter
//   - Son N event'in DN/op listesi — Audit sayfasında ayrı tab
//   - Bizim audit DB'ye YAZMIYOR — okuma anında üretilir, retention slapd'da
//
// Setup zorunlulukları (admin yapacak):
//   - cn=accesslog database eklenmiş olmalı
//   - `accesslog` overlay {2}mdb'ye bağlanmış olmalı
//   - bind hesabı cn=accesslog'u okuyabilmeli
//
// Yoksa: ExternalAudit Available()=false döner, UI bunu görüp "configured: false"
// mesajını gösterir, dashboard counter'ları "—" yazar.
type ExternalAudit struct {
	cfg *config.Config

	mu      sync.RWMutex
	cache   *Snapshot
	lastErr string
}

// Snapshot accesslog'dan derive edilen, dashboard ve UI'a sunulan veri.
type Snapshot struct {
	Available bool      `json:"available"`
	Error     string    `json:"error,omitempty"`
	Last24h   int       `json:"last24h"`
	Last1h    int       `json:"last1h"`
	WriteOps  int       `json:"writeOps"` // add+modify+delete
	ReadOps   int       `json:"readOps"`  // search+compare+bind
	Recent    []Event   `json:"recent"`   // son N event
	UpdatedAt time.Time `json:"updatedAt"`
}

// Event tek bir LDAP operasyonu.
type Event struct {
	Timestamp time.Time `json:"timestamp"`
	Op        string    `json:"op"`       // add, modify, delete, search, bind...
	ReqDN     string    `json:"reqDN"`    // operasyonun hedefi
	ReqAuthz  string    `json:"reqAuthz"` // bind eden DN
	Result    string    `json:"result"`   // "0" success, diğer hata kodları
	Source    string    `json:"source"`   // "external" | "mtl-ldap-admin"
}

func New(cfg *config.Config) *ExternalAudit {
	return &ExternalAudit{cfg: cfg}
}

// Refresh accesslog'dan son 24 saatlik event'leri çeker, snapshot'ı günceller.
// Background goroutine'den ya da on-demand çağrılır. Hata oluşursa eski cache
// korunur (UI bocalamaz), Available=false ile yeni snapshot yazılır.
func (e *ExternalAudit) Refresh() {
	snap := e.fetch()
	e.mu.Lock()
	e.cache = snap
	if !snap.Available {
		e.lastErr = snap.Error
	} else {
		e.lastErr = ""
	}
	e.mu.Unlock()
}

// Get cached snapshot. İlk çağrıda boşsa fetch eder.
func (e *ExternalAudit) Get() *Snapshot {
	e.mu.RLock()
	c := e.cache
	e.mu.RUnlock()
	if c != nil {
		return c
	}
	e.Refresh()
	e.mu.RLock()
	defer e.mu.RUnlock()
	return e.cache
}

// StartBackground 5 dakikada bir refresh eder.
func (e *ExternalAudit) StartBackground() {
	go func() {
		// İlk anlık fetch
		e.Refresh()
		t := time.NewTicker(5 * time.Minute)
		defer t.Stop()
		for range t.C {
			e.Refresh()
		}
	}()
}

func (e *ExternalAudit) fetch() *Snapshot {
	out := &Snapshot{
		UpdatedAt: time.Now(),
		Recent:    []Event{},
	}
	conn, err := goldap.DialURL(e.cfg.LDAP.URL)
	if err != nil {
		out.Error = fmt.Sprintf("dial: %v", err)
		return out
	}
	defer conn.Close()
	if err := conn.Bind(e.cfg.LDAP.BindDN, e.cfg.LDAP.BindPassword); err != nil {
		out.Error = fmt.Sprintf("bind: %v", err)
		return out
	}

	// cn=accesslog default base. Yoksa search no such object verir.
	since := time.Now().Add(-24 * time.Hour).UTC().Format("20060102150405.000000Z")
	req := goldap.NewSearchRequest(
		"cn=accesslog",
		goldap.ScopeWholeSubtree, goldap.NeverDerefAliases,
		2000, 30, false,
		fmt.Sprintf("(reqStart>=%s)", since),
		[]string{"reqStart", "reqType", "reqDN", "reqAuthzID", "reqResult"},
		nil,
	)
	res, err := conn.Search(req)
	if err != nil {
		// "no such object" → accesslog kurulu değil; bunu hata olarak değil
		// "available=false" olarak göster.
		errStr := err.Error()
		if strings.Contains(strings.ToLower(errStr), "no such object") {
			out.Error = "cn=accesslog yok — overlay yüklü değil"
		} else {
			out.Error = errStr
		}
		return out
	}

	out.Available = true
	now := time.Now()
	cutoff1h := now.Add(-1 * time.Hour)
	for _, ent := range res.Entries {
		op := ent.GetAttributeValue("reqType")
		ts := parseGeneralizedTime(ent.GetAttributeValue("reqStart"))
		ev := Event{
			Timestamp: ts,
			Op:        op,
			ReqDN:     ent.GetAttributeValue("reqDN"),
			ReqAuthz:  ent.GetAttributeValue("reqAuthzID"),
			Result:    ent.GetAttributeValue("reqResult"),
			Source:    classifySource(ent.GetAttributeValue("reqAuthzID"), e.cfg.LDAP.BindDN),
		}
		out.Last24h++
		if ts.After(cutoff1h) {
			out.Last1h++
		}
		switch strings.ToLower(op) {
		case "add", "modify", "delete", "modrdn":
			out.WriteOps++
		case "search", "compare", "bind":
			out.ReadOps++
		}
		out.Recent = append(out.Recent, ev)
	}

	// Recent reverse sort + cap
	if len(out.Recent) > 100 {
		out.Recent = out.Recent[len(out.Recent)-100:]
	}
	// Reverse — son event en başa gelsin
	for i, j := 0, len(out.Recent)-1; i < j; i, j = i+1, j-1 {
		out.Recent[i], out.Recent[j] = out.Recent[j], out.Recent[i]
	}
	return out
}

// classifySource bind eden DN'in MTL LDAP Admin'in servis hesabı olup olmadığına bakar.
// dn match → internal; aksi halde external.
func classifySource(reqAuthz, internalBindDN string) string {
	// reqAuthzID format: "dn:<DN>" veya "u:<userid>" (RFC 4513).
	dn := strings.TrimPrefix(strings.ToLower(reqAuthz), "dn:")
	if strings.EqualFold(strings.TrimSpace(dn), strings.TrimSpace(internalBindDN)) {
		return "internal"
	}
	return "external"
}

func parseGeneralizedTime(s string) time.Time {
	// "20260501093015.123456Z" — accesslog format
	if s == "" {
		return time.Time{}
	}
	for _, layout := range []string{
		"20060102150405.000000Z",
		"20060102150405Z",
	} {
		if t, err := time.Parse(layout, s); err == nil {
			return t
		}
	}
	return time.Time{}
}
