package ldap

import (
	"fmt"
	"strconv"

	goldap "github.com/go-ldap/ldap/v3"
)

// PosixInfo bir kullanıcının posixAccount attribute'ları.
// Hiçbiri set değilse posixAccount objectClass'ı yok demektir.
type PosixInfo struct {
	HasPosix      bool   `json:"hasPosix"`
	UIDNumber     int    `json:"uidNumber,omitempty"`
	GIDNumber     int    `json:"gidNumber,omitempty"`
	HomeDirectory string `json:"homeDirectory,omitempty"`
	LoginShell    string `json:"loginShell,omitempty"`
	GecosName     string `json:"gecos,omitempty"`
}

// GetPosix kullanıcının posix attribute'larını okur.
func (p *Pool) GetPosix(uid string) (*PosixInfo, error) {
	c, err := p.Get()
	if err != nil {
		return nil, err
	}
	defer p.Put(c)

	req := goldap.NewSearchRequest(
		p.cfg.UsersDN(),
		goldap.ScopeWholeSubtree, goldap.NeverDerefAliases,
		2, 0, false,
		fmt.Sprintf("(&(objectClass=inetOrgPerson)(uid=%s))", goldap.EscapeFilter(uid)),
		[]string{"objectClass", "uidNumber", "gidNumber", "homeDirectory", "loginShell", "gecos"},
		nil,
	)
	res, err := c.Search(req)
	if err != nil {
		return nil, err
	}
	if len(res.Entries) == 0 {
		return nil, fmt.Errorf("kullanıcı bulunamadı")
	}
	e := res.Entries[0]
	hasPosix := false
	for _, oc := range e.GetAttributeValues("objectClass") {
		if oc == "posixAccount" {
			hasPosix = true
			break
		}
	}
	info := &PosixInfo{
		HasPosix:      hasPosix,
		HomeDirectory: e.GetAttributeValue("homeDirectory"),
		LoginShell:    e.GetAttributeValue("loginShell"),
		GecosName:     e.GetAttributeValue("gecos"),
	}
	if v := e.GetAttributeValue("uidNumber"); v != "" {
		info.UIDNumber, _ = strconv.Atoi(v)
	}
	if v := e.GetAttributeValue("gidNumber"); v != "" {
		info.GIDNumber, _ = strconv.Atoi(v)
	}
	return info, nil
}

type SetPosixInput struct {
	UIDNumber     int    `json:"uidNumber,omitempty"` // 0 ise auto-assign
	GIDNumber     int    `json:"gidNumber,omitempty"`
	HomeDirectory string `json:"homeDirectory,omitempty"` // boşsa /home/{uid}
	LoginShell    string `json:"loginShell,omitempty"`    // boşsa /bin/bash
	GecosName     string `json:"gecos,omitempty"`
}

// SetPosix posixAccount attribute'larını ekler/günceller. objectClass yoksa
// önce auxiliary olarak ekler. Auto-assign için NextUIDNumber kullan.
func (p *Pool) SetPosix(uid string, in SetPosixInput) error {
	info, err := p.GetPosix(uid)
	if err != nil {
		return err
	}

	// Auto-assign UID
	if in.UIDNumber == 0 {
		next, err := p.NextUIDNumber()
		if err != nil {
			return fmt.Errorf("auto-assign uidNumber: %w", err)
		}
		in.UIDNumber = next
	}
	if in.GIDNumber == 0 {
		// Pratik default: kullanıcı için private group yoksa "users" GID'i
		in.GIDNumber = in.UIDNumber
	}
	if in.HomeDirectory == "" {
		in.HomeDirectory = "/home/" + uid
	}
	if in.LoginShell == "" {
		in.LoginShell = "/bin/bash"
	}

	c, err := p.Get()
	if err != nil {
		return err
	}
	defer p.Put(c)

	dn := fmt.Sprintf("uid=%s,%s", uid, p.cfg.UsersDN())
	req := goldap.NewModifyRequest(dn, nil)

	if !info.HasPosix {
		// auxiliary class ekleniyor
		req.Add("objectClass", []string{"posixAccount"})
		req.Add("uidNumber", []string{strconv.Itoa(in.UIDNumber)})
		req.Add("gidNumber", []string{strconv.Itoa(in.GIDNumber)})
		req.Add("homeDirectory", []string{in.HomeDirectory})
		// loginShell ve gecos optional MAY → Add ama boşsa atla
		if in.LoginShell != "" {
			req.Add("loginShell", []string{in.LoginShell})
		}
		if in.GecosName != "" {
			req.Add("gecos", []string{in.GecosName})
		}
	} else {
		req.Replace("uidNumber", []string{strconv.Itoa(in.UIDNumber)})
		req.Replace("gidNumber", []string{strconv.Itoa(in.GIDNumber)})
		req.Replace("homeDirectory", []string{in.HomeDirectory})
		if in.LoginShell != "" {
			req.Replace("loginShell", []string{in.LoginShell})
		}
		if in.GecosName != "" {
			req.Replace("gecos", []string{in.GecosName})
		}
	}
	return c.Modify(req)
}

// RemovePosix posixAccount attribute'larını ve objectClass'ını kaldırır.
func (p *Pool) RemovePosix(uid string) error {
	info, err := p.GetPosix(uid)
	if err != nil {
		return err
	}
	if !info.HasPosix {
		return nil
	}
	c, err := p.Get()
	if err != nil {
		return err
	}
	defer p.Put(c)

	dn := fmt.Sprintf("uid=%s,%s", uid, p.cfg.UsersDN())
	req := goldap.NewModifyRequest(dn, nil)
	// Önce objectClass'ı sil — server attribute'ları otomatik temizler
	req.Delete("objectClass", []string{"posixAccount"})
	// Bazı serverlar attribute'ları otomatik silmez; explicitly delete edelim
	req.Delete("uidNumber", []string{})
	req.Delete("gidNumber", []string{})
	req.Delete("homeDirectory", []string{})
	if info.LoginShell != "" {
		req.Delete("loginShell", []string{})
	}
	if info.GecosName != "" {
		req.Delete("gecos", []string{})
	}
	return c.Modify(req)
}

// NextUIDNumber mevcut en yüksek uidNumber + 1 döner. Posix kullanıcıları yoksa
// 10000 başlar (sistem UID'leri ile çakışmamak için).
func (p *Pool) NextUIDNumber() (int, error) {
	c, err := p.Get()
	if err != nil {
		return 0, err
	}
	defer p.Put(c)

	req := goldap.NewSearchRequest(
		p.cfg.UsersDN(),
		goldap.ScopeWholeSubtree, goldap.NeverDerefAliases,
		0, 0, false,
		"(objectClass=posixAccount)",
		[]string{"uidNumber"}, nil,
	)
	res, err := c.Search(req)
	if err != nil {
		return 0, err
	}
	max := 9999
	for _, e := range res.Entries {
		if v, err := strconv.Atoi(e.GetAttributeValue("uidNumber")); err == nil && v > max {
			max = v
		}
	}
	return max + 1, nil
}
