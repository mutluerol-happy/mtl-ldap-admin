package ldap

import (
	"fmt"
	"strings"

	goldap "github.com/go-ldap/ldap/v3"
)

type Group struct {
	DN          string   `json:"dn"`
	CN          string   `json:"cn"`
	Description string   `json:"description"`
	Members     []string `json:"members"` // member DN listesi
}

func (p *Pool) ListGroups(q string) ([]Group, error) {
	c, err := p.Get()
	if err != nil {
		return nil, err
	}
	defer p.Put(c)

	var filter string
	objClass := "(|(objectClass=groupOfNames)(objectClass=groupOfUniqueNames))"
	if q == "" {
		filter = objClass
	} else {
		esc := goldap.EscapeFilter(q)
		filter = fmt.Sprintf("(&%s(|(cn=*%s*)(description=*%s*)))", objClass, esc, esc)
	}

	req := goldap.NewSearchRequest(
		p.cfg.GroupsDN(),
		goldap.ScopeWholeSubtree, goldap.NeverDerefAliases,
		500, 0, false,
		filter,
		[]string{"cn", "description", "member", "uniqueMember"}, nil,
	)
	res, err := c.Search(req)
	if err != nil {
		return nil, err
	}

	out := make([]Group, 0, len(res.Entries))
	for _, e := range res.Entries {
		members := e.GetAttributeValues("member")
		if len(members) == 0 {
			members = e.GetAttributeValues("uniqueMember")
		}
		out = append(out, Group{
			DN:          e.DN,
			CN:          e.GetAttributeValue("cn"),
			Description: e.GetAttributeValue("description"),
			Members:     members,
		})
	}
	return out, nil
}

func (p *Pool) GetGroup(cn string) (*Group, error) {
	groups, err := p.ListGroups("")
	if err != nil {
		return nil, err
	}
	for _, g := range groups {
		if g.CN == cn {
			return &g, nil
		}
	}
	return nil, fmt.Errorf("grup bulunamadı")
}

type CreateGroupInput struct {
	CN          string `json:"cn"`
	Description string `json:"description"`
}

func (p *Pool) CreateGroup(in CreateGroupInput) (string, error) {
	if in.CN == "" {
		return "", fmt.Errorf("cn zorunlu")
	}
	c, err := p.Get()
	if err != nil {
		return "", err
	}
	defer p.Put(c)

	dn := fmt.Sprintf("cn=%s,%s", in.CN, p.cfg.GroupsDN())
	req := goldap.NewAddRequest(dn, nil)
	req.Attribute("objectClass", []string{"groupOfNames", "top"})
	req.Attribute("cn", []string{in.CN})
	if in.Description != "" {
		req.Attribute("description", []string{in.Description})
	}
	// groupOfNames en az bir member gerektirir; başlangıç olarak servis hesabını koy.
	// Kullanıcılar UI'dan üye ekledikten sonra bunu kaldırabilir.
	req.Attribute("member", []string{p.cfg.BindDN})

	if err := c.Add(req); err != nil {
		return "", fmt.Errorf("ldap add: %w", err)
	}
	return dn, nil
}

func (p *Pool) DeleteGroup(cn string) error {
	c, err := p.Get()
	if err != nil {
		return err
	}
	defer p.Put(c)
	dn := fmt.Sprintf("cn=%s,%s", cn, p.cfg.GroupsDN())
	return c.Del(goldap.NewDelRequest(dn, nil))
}

func (p *Pool) AddGroupMember(groupCN, userUID string) error {
	c, err := p.Get()
	if err != nil {
		return err
	}
	defer p.Put(c)

	groupDN := fmt.Sprintf("cn=%s,%s", groupCN, p.cfg.GroupsDN())
	userDN := fmt.Sprintf("uid=%s,%s", userUID, p.cfg.UsersDN())
	req := goldap.NewModifyRequest(groupDN, nil)
	req.Add("member", []string{userDN})
	if err := c.Modify(req); err != nil {
		if strings.Contains(strings.ToLower(err.Error()), "already exists") {
			return nil // idempotent
		}
		return err
	}
	return nil
}

func (p *Pool) RemoveGroupMember(groupCN, userUID string) error {
	c, err := p.Get()
	if err != nil {
		return err
	}
	defer p.Put(c)

	groupDN := fmt.Sprintf("cn=%s,%s", groupCN, p.cfg.GroupsDN())
	userDN := fmt.Sprintf("uid=%s,%s", userUID, p.cfg.UsersDN())
	req := goldap.NewModifyRequest(groupDN, nil)
	req.Delete("member", []string{userDN})
	return c.Modify(req)
}
