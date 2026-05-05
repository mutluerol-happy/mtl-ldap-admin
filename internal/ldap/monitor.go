package ldap

import (
	"strconv"
	"strings"

	goldap "github.com/go-ldap/ldap/v3"
)

// MonitorInfo cn=Monitor altından okunan canlılık + replication bilgisi.
// OpenLDAP'ın monitor backend'i (back-monitor) yüklü değilse Available=false.
type MonitorInfo struct {
	Available    bool             `json:"available"`
	Error        string           `json:"error,omitempty"`
	CurrentConns int              `json:"currentConnections"`
	TotalConns   int              `json:"totalConnections"`
	Operations   map[string]int64 `json:"operations,omitempty"` // bind, search, modify, ...
	Statistics   map[string]int64 `json:"statistics,omitempty"` // bytes, entries, referrals, ...
	Threads      *ThreadInfo      `json:"threads,omitempty"`
	Replication  []ReplicaInfo    `json:"replication,omitempty"`
	ContextCSN   string           `json:"contextCSN,omitempty"`
}

type ThreadInfo struct {
	Max     int `json:"max"`
	Open    int `json:"open"`
	Active  int `json:"active"`
	Pending int `json:"pending"`
}

// ReplicaInfo OpenLDAP syncrepl consumer/provider bilgisi.
// Ortam farklılıklarını absorbe etmek için DN ve raw description tutuyoruz.
type ReplicaInfo struct {
	DN          string   `json:"dn"`
	Description string   `json:"description,omitempty"`
	URI         string   `json:"uri,omitempty"`
	State       string   `json:"state,omitempty"`
	LastCSN     string   `json:"lastCSN,omitempty"`
	Raw         []string `json:"raw,omitempty"` // ham label'lar — UI'da debug için
}

// Monitor cn=Monitor altını gezerek özet bilgi toplar.
// OpenLDAP-spesifik attribute isimleri kullanır; başka serverlarda Available=false.
func (p *Pool) Monitor() (*MonitorInfo, error) {
	c, err := p.Get()
	if err != nil {
		return nil, err
	}
	defer p.Put(c)

	out := &MonitorInfo{
		Operations: map[string]int64{},
		Statistics: map[string]int64{},
	}

	// Önce cn=Monitor base entry test et
	_, err = c.Search(goldap.NewSearchRequest(
		"cn=Monitor", goldap.ScopeBaseObject, goldap.NeverDerefAliases,
		1, 0, false, "(objectClass=*)", []string{"dn"}, nil,
	))
	if err != nil {
		out.Available = false
		out.Error = "cn=Monitor erişilemiyor — back-monitor overlay yüklü olmalı"
		return out, nil
	}
	out.Available = true

	// Connections
	if r, err := c.Search(goldap.NewSearchRequest(
		"cn=Connections,cn=Monitor", goldap.ScopeSingleLevel, goldap.NeverDerefAliases,
		100, 0, false, "(objectClass=*)",
		[]string{"cn", "monitorCounter"}, nil,
	)); err == nil {
		for _, e := range r.Entries {
			cn := strings.ToLower(e.GetAttributeValue("cn"))
			v, _ := strconv.ParseInt(e.GetAttributeValue("monitorCounter"), 10, 64)
			switch cn {
			case "current":
				out.CurrentConns = int(v)
			case "total":
				out.TotalConns = int(v)
			}
		}
	}

	// Operations
	if r, err := c.Search(goldap.NewSearchRequest(
		"cn=Operations,cn=Monitor", goldap.ScopeSingleLevel, goldap.NeverDerefAliases,
		100, 0, false, "(objectClass=*)",
		[]string{"cn", "monitorOpInitiated", "monitorOpCompleted"}, nil,
	)); err == nil {
		for _, e := range r.Entries {
			name := strings.ToLower(e.GetAttributeValue("cn"))
			completed, _ := strconv.ParseInt(e.GetAttributeValue("monitorOpCompleted"), 10, 64)
			out.Operations[name] = completed
		}
	}

	// Statistics
	if r, err := c.Search(goldap.NewSearchRequest(
		"cn=Statistics,cn=Monitor", goldap.ScopeSingleLevel, goldap.NeverDerefAliases,
		100, 0, false, "(objectClass=*)",
		[]string{"cn", "monitorCounter"}, nil,
	)); err == nil {
		for _, e := range r.Entries {
			name := strings.ToLower(e.GetAttributeValue("cn"))
			v, _ := strconv.ParseInt(e.GetAttributeValue("monitorCounter"), 10, 64)
			out.Statistics[name] = v
		}
	}

	// Threads
	if r, err := c.Search(goldap.NewSearchRequest(
		"cn=Threads,cn=Monitor", goldap.ScopeBaseObject, goldap.NeverDerefAliases,
		1, 0, false, "(objectClass=*)",
		[]string{"monitoredInfo"}, nil,
	)); err == nil && len(r.Entries) > 0 {
		out.Threads = parseThreadInfo(r.Entries[0].GetAttributeValues("monitoredInfo"))
	}

	// contextCSN — BaseDN'in head csn'i, replication ölçümü için anchor
	if r, err := c.Search(goldap.NewSearchRequest(
		p.cfg.BaseDN, goldap.ScopeBaseObject, goldap.NeverDerefAliases,
		1, 0, false, "(objectClass=*)",
		[]string{"contextCSN"}, nil,
	)); err == nil && len(r.Entries) > 0 {
		out.ContextCSN = r.Entries[0].GetAttributeValue("contextCSN")
	}

	// Replication: cn=Replica*,cn=...,cn=Databases,cn=Monitor altını tara
	// Yapı sürümlere göre değişir; geniş bir filtreyle çekip değerlendiriyoruz.
	if r, err := c.Search(goldap.NewSearchRequest(
		"cn=Databases,cn=Monitor", goldap.ScopeWholeSubtree, goldap.NeverDerefAliases,
		200, 0, false,
		"(|(cn=Replica*)(cn=*Replication*))",
		[]string{"cn", "description", "labeledURI", "monitorRuntimeConfig", "monitoredInfo"},
		nil,
	)); err == nil {
		for _, e := range r.Entries {
			ri := ReplicaInfo{
				DN:          e.DN,
				Description: e.GetAttributeValue("description"),
				URI:         e.GetAttributeValue("labeledURI"),
			}
			info := e.GetAttributeValues("monitoredInfo")
			ri.Raw = info
			for _, line := range info {
				l := strings.ToLower(line)
				switch {
				case strings.HasPrefix(l, "csn="):
					ri.LastCSN = strings.TrimPrefix(line, "csn=")
				case strings.HasPrefix(l, "state="):
					ri.State = strings.TrimPrefix(line, "state=")
				}
			}
			out.Replication = append(out.Replication, ri)
		}
	}

	return out, nil
}

func parseThreadInfo(lines []string) *ThreadInfo {
	t := &ThreadInfo{}
	for _, line := range lines {
		// Örnekler: "max=16", "open=4", "active=1", "pending=0"
		parts := strings.SplitN(line, "=", 2)
		if len(parts) != 2 {
			continue
		}
		v, err := strconv.Atoi(strings.TrimSpace(parts[1]))
		if err != nil {
			continue
		}
		switch strings.ToLower(strings.TrimSpace(parts[0])) {
		case "max":
			t.Max = v
		case "open":
			t.Open = v
		case "active":
			t.Active = v
		case "pending":
			t.Pending = v
		}
	}
	return t
}
