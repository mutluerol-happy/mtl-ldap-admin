.PHONY: run build tidy test web-install web-dev web-build dev release ldap-up ldap-down seed clean

# --- Backend ---
run:
	go run ./cmd/server

build: web-build
	CGO_ENABLED=0 go build -ldflags="-s -w" -o bin/ldapui ./cmd/server

# Build for current platform without rebuilding frontend (faster iteration)
build-go:
	CGO_ENABLED=0 go build -ldflags="-s -w" -o bin/ldapui ./cmd/server

tidy:
	go mod tidy

test:
	go test ./...

# --- Frontend ---
web-install:
	cd web && npm install

web-dev:
	cd web && npm run dev

web-build:
	cd web && npm run build

# --- Combined ---
# Dev: backend on :8080, frontend on :5173 with API proxy.
# Run in two terminals: `make run` and `make web-dev`
dev:
	@echo "run two terminals: 'make run' and 'make web-dev'"
	@echo "or just 'make run' if you've already built the frontend with 'make web-build'"

# Cross-platform release builds
release: web-build
	mkdir -p dist
	CGO_ENABLED=0 GOOS=linux   GOARCH=amd64 go build -ldflags="-s -w" -o dist/ldapui-linux-amd64   ./cmd/server
	CGO_ENABLED=0 GOOS=linux   GOARCH=arm64 go build -ldflags="-s -w" -o dist/ldapui-linux-arm64   ./cmd/server
	CGO_ENABLED=0 GOOS=darwin  GOARCH=amd64 go build -ldflags="-s -w" -o dist/ldapui-darwin-amd64  ./cmd/server
	CGO_ENABLED=0 GOOS=darwin  GOARCH=arm64 go build -ldflags="-s -w" -o dist/ldapui-darwin-arm64  ./cmd/server
	CGO_ENABLED=0 GOOS=windows GOARCH=amd64 go build -ldflags="-s -w" -o dist/ldapui-windows-amd64.exe ./cmd/server
	@ls -lh dist/

# --- Local OpenLDAP for development ---
ldap-up:
	docker compose up -d

ldap-down:
	docker compose down -v

# Test data: ou=users, ou=groups, an admin group, and a few users
# Requires `ldap-utils` (apt install ldap-utils)
seed:
	@printf 'dn: ou=users,dc=example,dc=org\nobjectClass: organizationalUnit\nou: users\n\ndn: ou=groups,dc=example,dc=org\nobjectClass: organizationalUnit\nou: groups\n\ndn: uid=alice,ou=users,dc=example,dc=org\nobjectClass: inetOrgPerson\ncn: Alice Smith\nsn: Smith\ngivenName: Alice\nuid: alice\nmail: alice@example.org\nuserPassword: alicepass\n\ndn: uid=bob,ou=users,dc=example,dc=org\nobjectClass: inetOrgPerson\ncn: Bob Jones\nsn: Jones\ngivenName: Bob\nuid: bob\nmail: bob@example.org\nuserPassword: bobpass\n\ndn: cn=ldap-admins,ou=groups,dc=example,dc=org\nobjectClass: groupOfNames\ncn: ldap-admins\ndescription: ldapui administrators\nmember: uid=alice,ou=users,dc=example,dc=org\n\ndn: cn=developers,ou=groups,dc=example,dc=org\nobjectClass: groupOfNames\ncn: developers\ndescription: engineering team\nmember: uid=bob,ou=users,dc=example,dc=org\n' \
	| ldapadd -x -H ldap://localhost:389 -D "cn=admin,dc=example,dc=org" -w admin

clean:
	rm -rf bin dist web/node_modules web/dist
	mkdir -p web/dist
	@echo '<!doctype html><html><body><p>frontend not built — run `cd web && npm install && npm run build`</p></body></html>' > web/dist/index.html
