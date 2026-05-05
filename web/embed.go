package web

import (
	"embed"
	"io/fs"
)

//go:embed all:dist
var distFS embed.FS

// Dist gömülü SPA dosyalarını dist/ alt-yolu olmadan döndürür.
// Eğer build edilmemişse en azından placeholder index.html döner.
func Dist() (fs.FS, error) {
	return fs.Sub(distFS, "dist")
}
