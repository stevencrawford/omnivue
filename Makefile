PKG = github.com/stevencrawford/sess
COMMIT = $(shell git rev-parse --short HEAD)

BUILD_LDFLAGS = "-s -w -X $(PKG)/version.Revision=$(COMMIT)"

default: test

ci: depsdev generate test

generate:
	go generate ./internal/static/

test:
	cd internal/frontend && pnpm install && pnpm run test:coverage
	go test ./... -coverprofile=coverage.out -covermode=count -count=1

build: generate
	go build -ldflags=$(BUILD_LDFLAGS) -trimpath -o sess .

dev: build
	./sess -p 16275 --foreground $(ARGS)

screenshot: build
	cd internal/frontend && pnpm run screenshots

lint:
	cd internal/frontend && pnpm install && pnpm run fmt:check && pnpm run lint
	golangci-lint run ./...
	go vet -vettool=`which gostyle` -gostyle.config=$(PWD)/.gostyle.yml ./...

fmt:
	cd internal/frontend && pnpm install && pnpm run fmt

fmt-check:
	cd internal/frontend && pnpm install && pnpm run fmt:check

depsdev:
	go install github.com/Songmu/gocredits/cmd/gocredits@latest
	go install github.com/k1LoW/gostyle@latest

credits: depsdev generate
	go mod download
	gocredits -w .
	printf "\n================================================================\n\n" >> CREDITS
	cat internal/frontend/CREDITS_FRONTEND >> CREDITS

prerelease_for_tagpr: credits
	git add CHANGELOG.md CREDITS go.mod go.sum

.PHONY: default ci generate test build dev screenshot lint fmt fmt-check depsdev credits prerelease_for_tagpr
