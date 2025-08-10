//--------------- IMPORTS ---------------
import { Plugin, Notice, TFile, MetadataCache, PluginSettingTab, App, Setting, Vault, normalizePath, FileSystemAdapter, Modal } from "obsidian";

import { ZipWriter, BlobWriter, Uint8ArrayReader, ZipReader, Uint8ArrayWriter, BlobReader } from "@zip.js/zip.js";

import tar from "tar-stream";

import {gzip, ungzip} from "pako";

const ARCHIVE_TYPES = ["zip", "tar", "tar.gz"]

//--------------- LOCALES ---------------

import locales from "./locales"

function getUserLang(): string {
	const lang = window.localStorage.getItem("language");
	return lang?.split("-")[0] || "en";
}

function t(key: string): string {
	const lang = getUserLang();
	return locales[lang]?.[key] || locales["en"]?.[key] || key;
}

//--------------- PASSWORD MODAL ---------------

class PasswordPrompt extends Modal {
	private resolve!: (value: string | null) => void;
	private inputEl: HTMLInputElement;

	constructor(app: App) {
		super(app);
	}
	
	onOpen(): void {
		const { contentEl } = this;
		
		contentEl.classList.add("password-prompt");

		contentEl.createEl("h2", { text: t("password.enter") });
		
		const inputWrapper = contentEl.createDiv("input-wrapper");

		this.inputEl =  inputWrapper.createEl("input", { type: "password", placeholder: "...", cls: "password-input", value: "" });
		this.inputEl.focus();

		const showBtn = inputWrapper.createEl("button", {text: "🔒", cls: "show-password-btn"});
		showBtn.setAttr("type", "button");
		showBtn.addEventListener("mousedown", () => { this.inputEl.type = "text"; showBtn.textContent = "🔓" });
		showBtn.addEventListener("touchstart", () => { this.inputEl.type = "text"; showBtn.textContent = "🔓" });
		
		showBtn.addEventListener("mouseleave", () => { this.inputEl.type = "password"; showBtn.textContent = "🔒" });
		showBtn.addEventListener("mouseup", () => { this.inputEl.type = "password"; showBtn.textContent = "🔒" });
		showBtn.addEventListener("touchend", () => { this.inputEl.type = "password"; showBtn.textContent = "🔒" });

		this.inputEl.addEventListener("keydown", (e) => {
			if (e.key == "Enter") { this.submit() };
			if (e.key == "Escape") { this.resolve(null); this.close() }
		});

		const buttonContainer = contentEl.createDiv("modal-button-container");
		buttonContainer.classList.add("buttons")
		
		const cancerBtn = buttonContainer.createEl("button", {text: "❌", cls: "cancer-btn"})
		cancerBtn.addEventListener("click", () => {
			this.resolve(null);
			this.close();
		})

		const okBtn = buttonContainer.createEl("button", {text: "✅", cls: "submit-btn"});
		okBtn.addEventListener("click", () => this.submit());

	}

	private submit() {
		this.resolve(this.inputEl.value);
		this.close();
	}

	onClickBackdrop(evt: MouseEvent) {
		evt.stopPropagation();
	}

	onClose(): void {
		const { contentEl } = this;
		contentEl.empty();
	}

	openAndWait(): Promise<string | null> {
		this.open();
		return new Promise(resolve => { this.resolve = resolve })
	}
}

//--------------- PLUGIN SETTINGS ---------------

interface eqZIPeasyPluginSettings {
	maxDepth: number;
	exportFolder: string;
	importFolder: string;
	askPassword: boolean;
	defaultPassword: string;
}

const DEFAULT_SETTINGS: eqZIPeasyPluginSettings = { 
	maxDepth: 1, 
	exportFolder: "exports" ,
	importFolder: "",
	askPassword: false,
	defaultPassword: ""
}

class eaZIPeasySettingTab extends PluginSettingTab {
	plugin: eaZIPeasyPlugin;

	constructor(app: App, plugin: eaZIPeasyPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();
		containerEl.createEl("h1", {text: t("settings.header")})
		containerEl.createEl("h2", {text: t("settings.exportHeader")});
		
		new Setting(containerEl)
			.setName(t("settings.maxDepth"))
			.setDesc(t("settings.maxDepthDescr"))
			.addSlider((slider) => 
				slider
					.setLimits(-1, 5, 1)
					.setValue(this.plugin.settings.maxDepth)
					.setDynamicTooltip()
					.onChange(async (value) => {
						this.plugin.settings.maxDepth = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName(t("settings.exportFolder"))
			.setDesc(t("settings.exportFolderDescr"))
			.addText((text) =>
				text
					.setValue(this.plugin.settings.exportFolder)
					.onChange(async (value) => {
						this.plugin.settings.exportFolder = value;
						await this.plugin.saveSettings();
				})
			);
		
		new Setting(containerEl)
			.setName(t("settings.askPassword"))
			.setDesc(t("settings.askPasswordDescr"))
			.addToggle((value) => 
				value
					.setValue(this.plugin.settings.askPassword)
					.onChange(async (value) => {
						this.plugin.settings.askPassword = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName(t("settings.defaultPassword"))
			.setDesc(t("settings.defaultPasswordDescr"))
			.addText((text) => 
				text
					.setValue(this.plugin.settings.defaultPassword)
					.onChange(async (value) => {
						this.plugin.settings.defaultPassword = value.trim();
						await this.plugin.saveSettings();
					})
			)

		containerEl.createEl("h2", {text: t("settings.importHeader")});
		
		new Setting(containerEl)
			.setName(t("settings.importFolder"))
			.setDesc(t("settings.importFolderDescr"))
			.addText((text) =>
				text
					.setValue(this.plugin.settings.importFolder)
					.onChange(async (value) => {
						this.plugin.settings.importFolder = value;
						await this.plugin.saveSettings();
				})
			);
		}
	}
	
	//--------------- PLUGIN ---------------
	
export default class eaZIPeasyPlugin extends Plugin {
	settings: eqZIPeasyPluginSettings;
		
	async saveSettings() { await this.saveData(this.settings) } 
	
	async loadSettings() { this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData()) }

	async onload() {
		await this.loadSettings();

		const stylePath = `${this.manifest.dir}/styles.css`;
		try {
			const css = await this.app.vault.adapter.read(stylePath);
			const style = document.createElement("style");
			style.textContent = css;
			document.head.appendChild(style);
		} catch (e) { console.error("Cannot load styles.css", e) }

		this.addSettingTab(new eaZIPeasySettingTab(this.app, this));

		this.addCommand({
			id: "export-as-zip",
			name: t("commands.exportZip"),
			callback: () => { this.export("zip") }
		});

		this.addCommand({
			id: "export-as-tar",
			name: t("commands.exportTar"),
			callback: () => { this.export("tar") }
		});

		this.addCommand({
			id: "export-as-tar-gz",
			name: t("commands.exportTarGz"),
			callback: () => { this.export("tar.gz") }
		});

		this.addCommand({
			id: "import-from-archive",
			name: t("commands.import"),
			callback: () => { this.import() }
		});
	}

	async import() {
		const file = await this.selectArchive();
		
		if (!file) return;

		switch (true) {
			case file.name.endsWith("zip"):
				await this.extractZip(file, this.app.vault, this.settings.importFolder);
				break;
			
			case file.name.endsWith("tar"):
				await this.extractTar(file, this.app.vault, this.settings.importFolder);
				break;

			case file.name.endsWith("tar.gz"):
				const gzipData = new Uint8Array(await file.arrayBuffer());
				const tarData = ungzip(gzipData);
				await this.extractTar(new File([tarData as BlobPart], "share.tar", {type: "application/x-tar"}), this.app.vault, this.settings.importFolder);

			default:
				console.error("Unsupported archive type: ", file.type);
		}

	}

	selectArchive(): Promise<File | null> {
		return new Promise((resolve) => {
			const input = document.createElement("input");
			input.type = "file";
			input.accept = ARCHIVE_TYPES.join(", ");
			input.onchange = () => { resolve(input.files?.[0] ?? null) };
			input.click();
		})
	}

	async extractZip(file: File, vault: Vault, folder: string) {
		
		const passRaw = await this.getPassword("import");
		if (passRaw === null) return;
		const password = passRaw.trim() === "" ? undefined : passRaw.trim();
	
		const reader = new ZipReader(new BlobReader(file), {password});

		try {
			const entries = await reader.getEntries()
			for (const entry of entries) {
				const relativePath = entry.filename;

				if (!entry.directory) {

					const content = await entry.getData(new Uint8ArrayWriter());
					const fullPath = folder ? `${folder}/${relativePath}` : relativePath;
					const existingFIle = vault.getAbstractFileByPath(fullPath);
					await this.ensureFolderExists(fullPath, this.app.vault);

					if (!relativePath.endsWith(".md")) { 
						if (existingFIle instanceof TFile) { await this.app.fileManager.trashFile(existingFIle) }
						await vault.createBinary(fullPath, content.buffer as ArrayBuffer) }
					else {
						const text = new TextDecoder("utf-8").decode(content);
						if (existingFIle instanceof TFile) { await vault.modify(existingFIle, text) } 
						else { await vault.create(fullPath, text) }
					}
				}
			}
		} catch (err) {
			if (/File contains encrypted entry/i.test(err.message)) { new Notice(t("archive.encrypted")) }
			if (/Invalid password/i.test(err.message)) {new Notice(t("password.wrong"))}
		}
	}

	async extractTar(file: File, vault: Vault, folder: string) {
		
		const buf = await file.arrayBuffer();

		const extract = tar.extract();
		
		return new Promise<void>((resolve, reject) => {
			extract.on("entry", async (header, stream, next) => {
				const relativePath = header.name;
				const fullPath = folder ? `${folder}/${relativePath}` : relativePath;

				if (header.type === "file") {
					const chunks: Uint8Array[] = [];
					stream.on("data", chunk => chunks.push(chunk));
					stream.on("end", async () => {
						const content = new Uint8Array(chunks.reduce((acc, cur) => {
							const tmp = new Uint8Array(acc.length + cur.length);
							tmp.set(acc, 0);
							tmp.set(cur, acc.length);
							return tmp;
						}, new Uint8Array()));

						const existingFIle = vault.getAbstractFileByPath(fullPath);
						await this.ensureFolderExists(fullPath, vault);

						if (!relativePath.endsWith(".md")) {
							if (existingFIle instanceof TFile) await this.app.fileManager.trashFile(existingFIle);
							await vault.createBinary(fullPath, content.buffer);
						} else {
							const text = new TextDecoder("utf-8").decode(content);
							if (existingFIle instanceof TFile) await vault.modify(existingFIle, text)
							else await vault.create(fullPath, text);
						}
						next();
					});
					stream.resume();
				} else {
					next();
				}
			});
			extract.on("finish", () => resolve);
			extract.on("error", (e) => reject(e));

			extract.end(Buffer.from(buf));
		});
	}

	async ensureFolderExists(fullPath: string, vault: Vault): Promise<void> {
		const folders = fullPath.split("/").slice(0, -1);

		let currentPath = "";

		for (const folder of folders) {
			currentPath = currentPath ? `${currentPath}/${folder}` : folder;

			const abstract = vault.getAbstractFileByPath(currentPath);

			if (!abstract) { await vault.createFolder(currentPath) }
		}
	}

	async export(archiveType: string) {
		const activeFile = this.app.workspace.getActiveFile();
		if (!activeFile) {
			new Notice(t("current.none"));
			return;
		}

		const files = this.linksTraversal(activeFile, this.app.metadataCache, this.settings.maxDepth);


		var blob: Blob | null = null;
		switch (archiveType) {
			case "zip":
				blob = await this.createZip(files, this.app.vault);
				break;
			
			case "tar":
				blob = await this.createTar(files, this.app.vault);
				break;

			case "tar.gz":
				blob = await this.createTar(files, this.app.vault);
				blob = new Blob([gzip(await blob.arrayBuffer()) as BlobPart], {type: "application/gzip"});
				break;

			default:
				console.error("Unknown archive type");
		}
		if (blob === null) return;

		await this.shareBlob(blob, archiveType);
	}

	linksTraversal(startFile: TFile, metadataCache: MetadataCache, maxDepth: number): Set<string> {
		const files = new Set<string>();
		const queue: Array<{ file: TFile; depth: number }> = [{ file: startFile, depth: 0 }];

		while (queue.length > 0) {
			const {file, depth} = queue.shift()!;
			if ((depth > maxDepth || files.has(file.path)) && this.settings.maxDepth!=-1) continue;
			files.add(file.path);

			const cache = metadataCache.getFileCache(file);
			const links = cache?.links ?? [];
			const embeds = cache?.embeds ?? [];
			for (const item of [...links, ...embeds]) {
				const resolved = metadataCache.getFirstLinkpathDest(item.link, file.path);
				if (resolved) { 
					if (!files.has(resolved.path)) { queue.push({file: resolved, depth: depth + 1}) }
				}
			}
		}

		return files;
	}

	async createZip(files: Set<string>, vault: Vault): Promise<Blob | null> {

		const passRaw = await this.getPassword("export");
		if (passRaw === null) return null;
		const password = passRaw.trim() === "" ? undefined : passRaw.trim();
		
		const writer = new ZipWriter(new BlobWriter("application/zip"), 
			{password, encryptionStrength: 3, zipCrypto: false});
		
		for (const file of files) {
			const abstrFile = vault.getAbstractFileByPath(file);
			if (abstrFile instanceof TFile) { 
				await writer.add(file, 
					new Uint8ArrayReader(
						new Uint8Array(await vault.readBinary(abstrFile))),
					{ password }) 
			}
		}

		const zipBlob = await writer.close();
		return zipBlob;
	}

	async createTar(files: Set<string>, vault: Vault): Promise<Blob> {
		return new Promise((resolve, reject) => {
			const pack = tar.pack();
			const chunks: Uint8Array[] = [];

			pack.on("data", (chunk) => chunks.push(chunk));
			pack.on("end", () => {
				const tarBuf = Buffer.concat(chunks);
				const tarBlob = new Blob([tarBuf], {type: "application/x-tar"});
				resolve(tarBlob);
			});
			pack.on("error", reject);

			(async () => {
				try {
					for (const file of files) {
						await new Promise<void>(async (res, rej) => {
							const abstrFile = vault.getAbstractFileByPath(file);
							if (abstrFile instanceof TFile) {
								const fileData = new Uint8Array(await vault.readBinary(abstrFile))
								pack.entry({name: file, size: fileData.length}, new Buffer(fileData), (err) => {
									if (err) rej(err)
									else res();
								})
							}
						})
					}
					pack.finalize();
				} catch (e) { reject(e) };
			})();
		});
	}

	async getPassword(purpose: "export" | "import"): Promise<string | null> {
		if (purpose == "export") { if (!this.settings.askPassword) { return this.settings.defaultPassword } }
		const password = await new PasswordPrompt(this.app).openAndWait();
		if (password === null) {
			new Notice("Cancelled");
		}
		return password; 
	}

	async shareBlob(blob: Blob, archiveType: string) {
		const filename = "share."+archiveType;

		switch (archiveType) {
			case "zip": 
				break;

			case "tar":
				archiveType = "x-tar";
				break;

			case "tar.gz":
				archiveType = "gzip";
			
			default:
				break;
		}

		const file = new File([blob], filename, {type: "application/"+archiveType});

		if (navigator.canShare && navigator.canShare({files: [file]})) {
			navigator.share({ files: [file], title: "Share archive" })
		} else {
			const arrayBuffer = await blob.arrayBuffer();
			const exportFolder = this.settings.exportFolder;
			const fullPath = normalizePath(`${exportFolder}/${filename}`);
			
			const existing = this.app.vault.getAbstractFileByPath(fullPath);
			if (existing instanceof TFile) { await this.app.fileManager.trashFile(existing) }

			if (this.app.vault.getFolderByPath(exportFolder) === null) {
				await this.app.vault.createFolder(exportFolder);
			}

			await this.app.vault.createBinary(fullPath, arrayBuffer);

			new Notice(`Archive created at ${fullPath}`);
			
			if (!this.isMobile()) {
				const adapter = this.app.vault.adapter;
				if (adapter instanceof FileSystemAdapter) {	this.revealInFileExplorer(adapter.getFullPath(fullPath)) }
				else {new Notice("Cannot reveal file in system explorer on this platform")}
			}
   else { this.app.workspace.openLinkText(fullPath, "/", false); }
		}
	}

	isMobile() { return /Mobi|Android|iPhone|iPad|iPod|IEMobile/i.test(navigator.userAgent) }

	revealInFileExplorer(fullPath: string) {
		try {
			const {shell} = require('electron');
			setTimeout(() => {
				shell.showItemInFolder(fullPath);
			}, 100);
		} catch (err) { console.warn("Cannot open file", err) }
	}
}