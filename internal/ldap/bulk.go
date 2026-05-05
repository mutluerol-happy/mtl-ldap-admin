package ldap

import (
	"crypto/rand"
	"fmt"
)

// BulkResult tek bir bulk işlem sonucu.
type BulkResult struct {
	UID    string `json:"uid"`
	Status string `json:"status"` // "ok" | "failed"
	DN     string `json:"dn,omitempty"`
	Error  string `json:"error,omitempty"`
	// Bulk password reset için üretilen yeni parola.
	GeneratedPassword string `json:"generatedPassword,omitempty"`
}

// BulkSummary toplu bir işlem özeti.
type BulkSummary struct {
	Results []BulkResult `json:"results"`
	OK      int          `json:"ok"`
	Failed  int          `json:"failed"`
}

func summarize(results []BulkResult) BulkSummary {
	s := BulkSummary{Results: results}
	for _, r := range results {
		if r.Status == "ok" {
			s.OK++
		} else {
			s.Failed++
		}
	}
	return s
}

// BulkCreateUsers her input için CreateUser çağırır.
// Toplu bir işlemi tek transaction olarak çalıştırma yok; LDAP transaction
// desteklemiyor (çoğu sunucu için). Hatalar tek tek raporlanır.
func (p *Pool) BulkCreateUsers(inputs []CreateUserInput) BulkSummary {
	results := make([]BulkResult, 0, len(inputs))
	for _, in := range inputs {
		dn, err := p.CreateUser(in)
		if err != nil {
			results = append(results, BulkResult{
				UID: in.UID, Status: "failed", Error: err.Error(),
			})
			continue
		}
		results = append(results, BulkResult{UID: in.UID, Status: "ok", DN: dn})
	}
	return summarize(results)
}

func (p *Pool) BulkDeleteUsers(uids []string) BulkSummary {
	results := make([]BulkResult, 0, len(uids))
	for _, uid := range uids {
		if err := p.DeleteUser(uid); err != nil {
			results = append(results, BulkResult{UID: uid, Status: "failed", Error: err.Error()})
			continue
		}
		results = append(results, BulkResult{UID: uid, Status: "ok"})
	}
	return summarize(results)
}

func (p *Pool) BulkAddToGroup(groupCN string, uids []string) BulkSummary {
	results := make([]BulkResult, 0, len(uids))
	for _, uid := range uids {
		if err := p.AddGroupMember(groupCN, uid); err != nil {
			results = append(results, BulkResult{UID: uid, Status: "failed", Error: err.Error()})
			continue
		}
		results = append(results, BulkResult{UID: uid, Status: "ok"})
	}
	return summarize(results)
}

func (p *Pool) BulkRemoveFromGroup(groupCN string, uids []string) BulkSummary {
	results := make([]BulkResult, 0, len(uids))
	for _, uid := range uids {
		if err := p.RemoveGroupMember(groupCN, uid); err != nil {
			results = append(results, BulkResult{UID: uid, Status: "failed", Error: err.Error()})
			continue
		}
		results = append(results, BulkResult{UID: uid, Status: "ok"})
	}
	return summarize(results)
}

// BulkResetPasswords her kullanıcı için rastgele parola üretip set eder.
// Sonuçta üretilen parolalar yer alır — UI bunları bir kerelik göstermeli ya da
// CSV olarak indirtmeli; sonradan erişim olmaz.
func (p *Pool) BulkResetPasswords(uids []string, passwordLength int) BulkSummary {
	if passwordLength < 12 {
		passwordLength = 16
	}
	results := make([]BulkResult, 0, len(uids))
	for _, uid := range uids {
		pw, err := GeneratePassword(passwordLength)
		if err != nil {
			results = append(results, BulkResult{UID: uid, Status: "failed", Error: "rng: " + err.Error()})
			continue
		}
		if err := p.SetPassword(uid, pw); err != nil {
			results = append(results, BulkResult{UID: uid, Status: "failed", Error: err.Error()})
			continue
		}
		results = append(results, BulkResult{
			UID: uid, Status: "ok", GeneratedPassword: pw,
		})
	}
	return summarize(results)
}

// GeneratePassword crypto/rand'den okunabilir-ish güvenli parola üretir.
// Karışıklık çıkarabilecek karakterleri (0/O, 1/l/I) çıkarır.
func GeneratePassword(length int) (string, error) {
	const charset = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#$%&*+="
	if length <= 0 {
		length = 16
	}
	b := make([]byte, length)
	if _, err := rand.Read(b); err != nil {
		return "", fmt.Errorf("rand: %w", err)
	}
	for i := range b {
		b[i] = charset[int(b[i])%len(charset)]
	}
	return string(b), nil
}
