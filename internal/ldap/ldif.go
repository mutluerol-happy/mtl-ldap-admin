package ldap

import (
	"bufio"
	"encoding/base64"
	"fmt"
	"io"
	"strings"

	goldap "github.com/go-ldap/ldap/v3"
)

// ExportLDIF BaseDN altındaki tüm entry'leri standart LDIF formatında yazar.
// Binary değerler ve özel karakterler base64'e çevrilir (":: " syntax'ı).
func (p *Pool) ExportLDIF(w io.Writer) error {
	c, err := p.Get()
	if err != nil {
		return err
	}
	defer p.Put(c)

	req := goldap.NewSearchRequest(
		p.cfg.BaseDN,
		goldap.ScopeWholeSubtree, goldap.NeverDerefAliases,
		0, 0, false,
		"(objectClass=*)",
		[]string{"*"}, nil,
	)
	res, err := c.Search(req)
	if err != nil {
		return err
	}

	bw := bufio.NewWriter(w)
	defer bw.Flush()

	fmt.Fprintf(bw, "# mtl-ldap-admin export — %d entries\n# base: %s\n\n", len(res.Entries), p.cfg.BaseDN)

	for _, e := range res.Entries {
		writeLDIFLine(bw, "dn", e.DN)
		for _, attr := range e.Attributes {
			for _, v := range attr.Values {
				writeLDIFLine(bw, attr.Name, v)
			}
		}
		fmt.Fprintln(bw)
	}
	return nil
}

func writeLDIFLine(w io.Writer, name, value string) {
	if needsBase64(value) {
		fmt.Fprintf(w, "%s:: %s\n", name, base64.StdEncoding.EncodeToString([]byte(value)))
		return
	}
	fmt.Fprintf(w, "%s: %s\n", name, value)
}

func needsBase64(s string) bool {
	if s == "" {
		return false
	}
	if s[0] == ' ' || s[0] == ':' || s[0] == '<' {
		return true
	}
	for i := 0; i < len(s); i++ {
		b := s[i]
		if b == '\n' || b == '\r' || b == 0 || b > 0x7F {
			return true
		}
	}
	return false
}

type LDIFResult struct {
	Added  int      `json:"added"`
	Failed int      `json:"failed"`
	Errors []string `json:"errors,omitempty"`
}

// ImportLDIF basit bir LDIF parser. Boş satırlarla ayrılmış entry blokları okur,
// her bloku LDAP add olarak gönderir. modify/delete operasyonları henüz desteklenmiyor.
func (p *Pool) ImportLDIF(r io.Reader) (*LDIFResult, error) {
	c, err := p.Get()
	if err != nil {
		return nil, err
	}
	defer p.Put(c)

	res := &LDIFResult{}
	scanner := bufio.NewScanner(r)
	scanner.Buffer(make([]byte, 64*1024), 1024*1024) // 1MB max line

	var lines []string

	flush := func() {
		if len(lines) == 0 {
			return
		}
		defer func() { lines = nil }()

		var dn string
		attrs := map[string][]string{}
		for _, line := range lines {
			name, value, ok := parseLDIFLine(line)
			if !ok {
				continue
			}
			if strings.EqualFold(name, "dn") {
				dn = value
				continue
			}
			// changetype'lı bloklar şimdilik atlanıyor
			if strings.EqualFold(name, "changetype") {
				return
			}
			attrs[name] = append(attrs[name], value)
		}
		if dn == "" {
			res.Failed++
			res.Errors = append(res.Errors, "dn yok")
			return
		}
		req := goldap.NewAddRequest(dn, nil)
		for k, vs := range attrs {
			req.Attribute(k, vs)
		}
		if err := c.Add(req); err != nil {
			res.Failed++
			res.Errors = append(res.Errors, fmt.Sprintf("%s: %v", dn, err))
			return
		}
		res.Added++
	}

	for scanner.Scan() {
		line := scanner.Text()
		if strings.HasPrefix(line, "#") {
			continue
		}
		if line == "" {
			flush()
			continue
		}
		// continuation: önünde boşluk olan satır önceki satıra eklenir
		if strings.HasPrefix(line, " ") && len(lines) > 0 {
			lines[len(lines)-1] += line[1:]
			continue
		}
		lines = append(lines, line)
	}
	flush()

	if err := scanner.Err(); err != nil {
		return res, err
	}
	return res, nil
}

func parseLDIFLine(line string) (name, value string, ok bool) {
	colon := strings.Index(line, ":")
	if colon < 0 {
		return "", "", false
	}
	name = line[:colon]
	rest := line[colon+1:]
	// "name:: base64value"
	if strings.HasPrefix(rest, ":") {
		raw, err := base64.StdEncoding.DecodeString(strings.TrimSpace(rest[1:]))
		if err != nil {
			return "", "", false
		}
		return name, string(raw), true
	}
	return name, strings.TrimLeft(rest, " "), true
}
