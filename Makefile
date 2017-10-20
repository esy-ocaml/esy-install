VERSION = $(shell node -p "require('./package.json').version")
RELEASE_ROOT = $(PWD)/packages/esy-install

build-bundle:
	@yarn $(@)

build-release: build-bundle
	@rm -rf $(RELEASE_ROOT)
	@mkdir -p $(RELEASE_ROOT)
	@mkdir -p $(RELEASE_ROOT)/bin
	@cp ./bin/esy-install $(RELEASE_ROOT)/bin/esy-install
	@cp ./artifacts/yarn-legacy-$(VERSION).js $(RELEASE_ROOT)/bin/esy-install.js
	@node ./scripts/generate-esy-install-package-json.js > $(RELEASE_ROOT)/package.json
	@echo "Package is ready 'packages/esy-install' directory, you can run 'make publish' to publish it"

publish: build-release
	@(cd $(RELEASE_ROOT) && npm publish --access public)
	@git push && git push --tags

bump-patch-version:
	@npm version patch

bump-minor-version:
	@npm version minor

bump-major-version:
	@npm version major
