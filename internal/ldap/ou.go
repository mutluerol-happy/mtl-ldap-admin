package ldap

import (
	"fmt"
	"strings"

	goldap "github.com/go-ldap/ldap/v3"
)

type OU struct {
	DN          string `json:"dn"`
	Name        string `json:"name"` // ou=foo'daki "foo"
	Description string `json:"description,omitempty"`
	ParentDN    string `json:"parentDN"`
}

// ListOUs BaseDN altındaki tüm organizationalUnit entry'lerini döner.
func (p *Pool) ListOUs() ([]OU, error) {
	c, err := p.Get()
	if err != nil {
		return nil, err
	}
	defer p.Put(c)

	req := goldap.NewSearchRequest(
		p.cfg.BaseDN,
		goldap.ScopeWholeSubtree, goldap.NeverDerefAliases,
		1000, 0, false,
		"(objectClass=organizationalUnit)",
		[]string{"ou", "description"}, nil,
	)
	res, err := c.Search(req)
	if err != nil {
		return nil, err
	}

	out := make([]OU, 0, len(res.Entries))
	for _, e := range res.Entries {
		parts := strings.SplitN(e.DN, ",", 2)
		parent := ""
		if len(parts) > 1 {
			parent = parts[1]
		}
		out = append(out, OU{
			DN:          e.DN,
			Name:        e.GetAttributeValue("ou"),
			Description: e.GetAttributeValue("description"),
			ParentDN:    parent,
		})
	}
	return out, nil
}

type CreateOUInput struct {
	Name        string `json:"name"`     // ou değeri
	ParentDN    string `json:"parentDN"` // boşsa BaseDN
	Description string `json:"description,omitempty"`
}

func (p *Pool) CreateOU(in CreateOUInput) (string, error) {
	if in.Name == "" {
		return "", fmt.Errorf("name zorunlu")
	}
	parent := in.ParentDN
	if parent == "" {
		parent = p.cfg.BaseDN
	}
	c, err := p.Get()
	if err != nil {
		return "", err
	}
	defer p.Put(c)

	dn := fmt.Sprintf("ou=%s,%s", in.Name, parent)
	req := goldap.NewAddRequest(dn, nil)
	req.Attribute("objectClass", []string{"organizationalUnit", "top"})
	req.Attribute("ou", []string{in.Name})
	if in.Description != "" {
		req.Attribute("description", []string{in.Description})
	}
	if err := c.Add(req); err != nil {
		return "", err
	}
	return dn, nil
}

func (p *Pool) DeleteOU(dn string) error {
	c, err := p.Get()
	if err != nil {
		return err
	}
	defer p.Put(c)
	// Boş olmayan OU silinemez. Server zaten "Not allowed on non-leaf" döner.
	return c.Del(goldap.NewDelRequest(dn, nil))
}
