package ldap

import (
	"fmt"
	"regexp"
	"strings"
	"sync"
	"time"

	goldap "github.com/go-ldap/ldap/v3"
)

// SchemaAttribute LDAP attributeType definition.
type SchemaAttribute struct {
	OID         string   `json:"oid"`
	Names       []string `json:"names"` // primary + aliases
	Description string   `json:"description"`
	Syntax      string   `json:"syntax,omitempty"`
	Equality    string   `json:"equality,omitempty"`
	Substring   string   `json:"substring,omitempty"`
	SingleValue bool     `json:"singleValue"`
	NoUserMod   bool     `json:"noUserMod"`
	Usage       string   `json:"usage,omitempty"` // "directoryOperation" gibi
	SuperType   string   `json:"superType,omitempty"`
}

type SchemaObjectClass struct {
	OID         string   `json:"oid"`
	Names       []string `json:"names"`
	Description string   `json:"description"`
	Kind        string   `json:"kind"` // "STRUCTURAL" | "AUXILIARY" | "ABSTRACT"
	SuperClass  []string `json:"superClass,omitempty"`
	Must        []string `json:"must,omitempty"`
	May         []string `json:"may,omitempty"`
}

type Schema struct {
	Attributes    []SchemaAttribute   `json:"attributes"`
	ObjectClasses []SchemaObjectClass `json:"objectClasses"`
}

// schemaCache şema değişmez varsayımıyla bellekte tutar.
type schemaCache struct {
	mu   sync.Mutex
	data *Schema
	at   time.Time
	ttl  time.Duration
}

var schemaCacheInstance = &schemaCache{ttl: 1 * time.Hour}

// LoadSchema önce cache, sonra LDAP. cn=Subschema/cn=schema entry'sini parse eder.
func (p *Pool) LoadSchema() (*Schema, error) {
	schemaCacheInstance.mu.Lock()
	if schemaCacheInstance.data != nil && time.Since(schemaCacheInstance.at) < schemaCacheInstance.ttl {
		s := schemaCacheInstance.data
		schemaCacheInstance.mu.Unlock()
		return s, nil
	}
	schemaCacheInstance.mu.Unlock()

	c, err := p.Get()
	if err != nil {
		return nil, err
	}
	defer p.Put(c)

	// Önce rootDSE'den subschemaSubentry'yi öğren
	root, err := c.Search(goldap.NewSearchRequest(
		"", goldap.ScopeBaseObject, goldap.NeverDerefAliases,
		1, 0, false, "(objectClass=*)",
		[]string{"subschemaSubentry", "namingContexts"}, nil,
	))
	if err != nil {
		return nil, fmt.Errorf("rootDSE: %w", err)
	}
	if len(root.Entries) == 0 {
		return nil, fmt.Errorf("rootDSE empty")
	}
	subDN := root.Entries[0].GetAttributeValue("subschemaSubentry")
	if subDN == "" {
		subDN = "cn=Subschema"
	}

	// Şema entry'sini al
	res, err := c.Search(goldap.NewSearchRequest(
		subDN, goldap.ScopeBaseObject, goldap.NeverDerefAliases,
		1, 0, false, "(objectClass=subschema)",
		[]string{"attributeTypes", "objectClasses"}, nil,
	))
	if err != nil {
		return nil, fmt.Errorf("schema: %w", err)
	}
	if len(res.Entries) == 0 {
		return nil, fmt.Errorf("subschema entry boş")
	}

	e := res.Entries[0]
	sch := &Schema{
		Attributes:    parseSchemaAttributes(e.GetAttributeValues("attributeTypes")),
		ObjectClasses: parseSchemaObjectClasses(e.GetAttributeValues("objectClasses")),
	}

	schemaCacheInstance.mu.Lock()
	schemaCacheInstance.data = sch
	schemaCacheInstance.at = time.Now()
	schemaCacheInstance.mu.Unlock()
	return sch, nil
}

// RefreshSchema cache'i temizler.
func (p *Pool) RefreshSchema() {
	schemaCacheInstance.mu.Lock()
	schemaCacheInstance.data = nil
	schemaCacheInstance.mu.Unlock()
}

// parseSchemaAttributes RFC 4512 AttributeTypeDescription'ı parse eder.
// Format örneği:
//
//	( 0.9.2342.19200300.100.1.1 NAME 'uid' DESC '...' EQUALITY caseIgnoreMatch
//	  SUBSTR caseIgnoreSubstringsMatch SYNTAX 1.3.6.1.4.1.1466.115.121.1.15{256}
//	  SINGLE-VALUE )
//
// Tam-grammar parser yapmıyoruz; pratikte yeterli regex tabanlı extractor.
func parseSchemaAttributes(defs []string) []SchemaAttribute {
	out := make([]SchemaAttribute, 0, len(defs))
	for _, d := range defs {
		out = append(out, parseAttrDef(d))
	}
	return out
}

func parseAttrDef(s string) SchemaAttribute {
	a := SchemaAttribute{}
	a.OID = extractOID(s)
	a.Names = extractNames(s)
	a.Description = extractQuoted(s, `DESC`)
	a.Syntax = extractTokenAfter(s, `SYNTAX`)
	a.Equality = extractTokenAfter(s, `EQUALITY`)
	a.Substring = extractTokenAfter(s, `SUBSTR`)
	a.Usage = extractTokenAfter(s, `USAGE`)
	a.SuperType = extractTokenAfter(s, `SUP`)
	a.SingleValue = strings.Contains(s, " SINGLE-VALUE")
	a.NoUserMod = strings.Contains(s, " NO-USER-MODIFICATION")
	return a
}

func parseSchemaObjectClasses(defs []string) []SchemaObjectClass {
	out := make([]SchemaObjectClass, 0, len(defs))
	for _, d := range defs {
		out = append(out, parseClassDef(d))
	}
	return out
}

func parseClassDef(s string) SchemaObjectClass {
	c := SchemaObjectClass{}
	c.OID = extractOID(s)
	c.Names = extractNames(s)
	c.Description = extractQuoted(s, `DESC`)
	c.SuperClass = extractParenList(s, `SUP`)
	c.Must = extractParenList(s, `MUST`)
	c.May = extractParenList(s, `MAY`)
	switch {
	case strings.Contains(s, " STRUCTURAL"):
		c.Kind = "STRUCTURAL"
	case strings.Contains(s, " AUXILIARY"):
		c.Kind = "AUXILIARY"
	case strings.Contains(s, " ABSTRACT"):
		c.Kind = "ABSTRACT"
	default:
		c.Kind = "STRUCTURAL"
	}
	return c
}

var (
	reOID     = regexp.MustCompile(`^\s*\(\s*([0-9.]+)`)
	reNameStr = regexp.MustCompile(`NAME\s+'([^']+)'`)
	reNameMul = regexp.MustCompile(`NAME\s+\(\s*([^)]+)\s*\)`)
)

func extractOID(s string) string {
	m := reOID.FindStringSubmatch(s)
	if len(m) > 1 {
		return m[1]
	}
	return ""
}

func extractNames(s string) []string {
	if m := reNameStr.FindStringSubmatch(s); len(m) > 1 {
		// olası multi-form da dene; yoksa tek
		if m2 := reNameMul.FindStringSubmatch(s); len(m2) > 1 {
			return splitQuoted(m2[1])
		}
		return []string{m[1]}
	}
	if m := reNameMul.FindStringSubmatch(s); len(m) > 1 {
		return splitQuoted(m[1])
	}
	return nil
}

func splitQuoted(s string) []string {
	out := []string{}
	cur := ""
	in := false
	for _, c := range s {
		if c == '\'' {
			if in {
				out = append(out, cur)
				cur = ""
			}
			in = !in
			continue
		}
		if in {
			cur += string(c)
		}
	}
	return out
}

func extractQuoted(s, key string) string {
	re := regexp.MustCompile(key + `\s+'([^']*)'`)
	m := re.FindStringSubmatch(s)
	if len(m) > 1 {
		return m[1]
	}
	return ""
}

// extractTokenAfter "EQUALITY caseIgnoreMatch" → "caseIgnoreMatch".
// SYNTAX için trailing "{...}" boyut bilgisini kırpmıyoruz.
func extractTokenAfter(s, key string) string {
	re := regexp.MustCompile(key + `\s+([^\s)]+)`)
	m := re.FindStringSubmatch(s)
	if len(m) > 1 {
		return m[1]
	}
	return ""
}

// extractParenList "MUST ( cn $ sn )" → ["cn","sn"]
// veya "MUST cn" → ["cn"].
func extractParenList(s, key string) []string {
	// Try paren form first
	reParen := regexp.MustCompile(key + `\s*\(\s*([^)]+)\s*\)`)
	if m := reParen.FindStringSubmatch(s); len(m) > 1 {
		parts := strings.Split(m[1], "$")
		out := make([]string, 0, len(parts))
		for _, p := range parts {
			if p = strings.TrimSpace(p); p != "" {
				out = append(out, p)
			}
		}
		return out
	}
	// Single token form
	re := regexp.MustCompile(key + `\s+([A-Za-z][A-Za-z0-9.-]*)`)
	if m := re.FindStringSubmatch(s); len(m) > 1 {
		return []string{m[1]}
	}
	return nil
}
