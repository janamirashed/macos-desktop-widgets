UUID = peachos-widgets@peachos
EXT_DIR = $(HOME)/.local/share/gnome-shell/extensions/$(UUID)
FONT_DIR = $(HOME)/.local/share/fonts
ZIP_NAME = $(UUID).zip

.PHONY: all install uninstall zip clean

all: build

build:
	glib-compile-schemas schemas/

install: build
	./install.sh

uninstall:
	./uninstall.sh

zip: build
	@rm -f $(ZIP_NAME)
	zip -r $(ZIP_NAME) \
		metadata.json \
		extension.js \
		stylesheet.css \
		lib/ \
		widgets/ \
		schemas/ \
		icons/ \
		fonts/ \
		previews/ \
		README.md \
		install.sh \
		uninstall.sh \
		-x "*.git*" "*~" "*.DS_Store"
	@echo "Created $(ZIP_NAME)"

clean:
	rm -f $(ZIP_NAME)
