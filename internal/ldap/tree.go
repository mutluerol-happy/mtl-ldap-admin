package ldap

import (
	"fmt"
	"strings"

	goldap "github.com/go-ldap/ldap/v3"
)

// TreeNode DN ağacında bir entry. Children sadece "var mı" bilgisidir;
// gerçek alt-entry'ler ayrıca istenir (lazy expand).
type TreeNode struct {
	DN          string   `json:"dn"`
	RDN         string   `json:"rdn"`
	ObjectClass []string `json:"objectClass"`
	HasChildren bool     `json:"hasChildren"`
	IsContainer bool     `json:"isContainer"`
}

// ListChildren bir DN'in doğrudan alt-entry'lerini döner.
// dn boşsa BaseDN'den başlar.
func (p *Pool) ListChildren(dn string) ([]TreeNode, error) {
	if dn == "" {
		dn = p.cfg.BaseDN
	}
	c, err := p.Get()
	if err != nil {
		return nil, err
	}
	defer p.Put(c)

	req := goldap.NewSearchRequest(
		dn, goldap.ScopeSingleLevel, goldap.NeverDerefAliases,
		1000, 0, false,
		"(objectClass=*)",
		[]string{"objectClass"}, nil,
	)
	res, err := c.Search(req)
	if err != nil {
		return nil, err
	}

	out := make([]TreeNode, 0, len(res.Entries))
	for _, e := range res.Entries {
		ocs := e.GetAttributeValues("objectClass")
		out = append(out, TreeNode{
			DN:          e.DN,
			RDN:         rdnOf(e.DN),
			ObjectClass: ocs,
			HasChildren: hasChildren(c, e.DN),
			IsContainer: isContainerClass(ocs),
		})
	}
	return out, nil
}

// hasChildren bir DN'in herhangi bir alt-entry'si var mı; ucuz kontrol için
// SizeLimit=1 kullanır.
func hasChildren(c interface {
	Search(*goldap.SearchRequest) (*goldap.SearchResult, error)
}, dn string) bool {
	res, err := c.Search(goldap.NewSearchRequest(
		dn, goldap.ScopeSingleLevel, goldap.NeverDerefAliases,
		1, 0, false, "(objectClass=*)", []string{"dn"}, nil,
	))
	if err != nil {
		return false
	}
	return len(res.Entries) > 0
}

// GetEntry tek bir entry'nin tüm attribute'larını döner.
type RawEntry struct {
	DN         string              `json:"dn"`
	Attributes map[string][]string `json:"attributes"`
}

func (p *Pool) GetEntry(dn string) (*RawEntry, error) {
	c, err := p.Get()
	if err != nil {
		return nil, err
	}
	defer p.Put(c)

	req := goldap.NewSearchRequest(
		dn, goldap.ScopeBaseObject, goldap.NeverDerefAliases,
		1, 0, false, "(objectClass=*)", []string{"*", "+"}, nil,
	)
	res, err := c.Search(req)
	if err != nil {
		return nil, err
	}
	if len(res.Entries) == 0 {
		return nil, fmt.Errorf("entry bulunamadı")
	}
	e := res.Entries[0]
	attrs := map[string][]string{}
	for _, a := range e.Attributes {
		// Binary attribute'lar (jpegPhoto, userCertificate vb.) yok sayılmıyor
		// ama UI'da bunları büyük metinler olarak göstermeyiz; önizleme yeterli.
		// İlerleyen sürümde attribute syntax'ına göre özel render.
		attrs[a.Name] = a.Values
	}
	return &RawEntry{DN: e.DN, Attributes: attrs}, nil
}

func rdnOf(dn string) string {
	parts := strings.SplitN(dn, ",", 2)
	if len(parts) == 0 {
		return dn
	}
	return parts[0]
}

func isContainerClass(ocs []string) bool {
	for _, oc := range ocs {
		l := strings.ToLower(oc)
		if l == "organizationalunit" || l == "organization" || l == "domain" ||
			l == "container" || l == "country" || l == "dcobject" {
			return true
		}
	}
	return false
}
