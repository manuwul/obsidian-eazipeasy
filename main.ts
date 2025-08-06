import { Plugin, Notice, TFile, MetadataCache, PluginSettingTab, App, Setting, Vault, normalizePath, FileSystemAdapter } from "obsidian";
import JSZip from "jszip";

import locales from "./locales"

function getUserLang(): string {
	const lang = window.localStorage.getItem("language");
	return lang?.split("-")[0] || "en";
}

function t(key: string): string {
	const lang = getUserLang();
	return locales[lang]?.[key] || locales["en"]?.[key] || key;
}


interface eqZIPeasyPluginSettings {
	maxDepth: number;
	exportFolder: string;
	importFolder: string;
}


const DEFAULT_SETTINGS: eqZIPeasyPluginSettings = { 
	maxDepth: 1, 
	exportFolder: "exports" ,
	importFolder: ""
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

export default class eaZIPeasyPlugin
extends Plugin {
	settings: eqZIPeasyPluginSettings;

	async onload() {
		await this.loadSettings();

		this.addSettingTab(new eaZIPeasySettingTab(this.app, this));

		this.addCommand({
			id: "export-as-zip",
			name: t("commands.export"),
			callback: () => { this.HandleExport() }
		});

		this.addCommand({
			id: "import-from-zip",
			name: t("commands.import"),
			callback: () => { this.HandleImport() }
		});
	}

	async loadSettings() { this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData()) }

	async saveSettings() { await this.saveData(this.settings) } 

	async HandleImport() {
		const file = await this.selectZip();
		if (!file) { new Notice("No file selected"); return }

		//console.log(`File selected: ${file.name}, ${file.size} bytes, ${file.type}`);

		const zip = await JSZip.loadAsync(await file.arrayBuffer());

		await this.saveZipToVault(zip, this.app.vault, this.settings.importFolder);
	}

	selectZip(): Promise<File | null> {
		return new Promise((resolve) => {
			const input = document.createElement("input");
			input.type = "file";
			input.accept = ".zip";
			input.onchange = () => { resolve(input.files?.[0] ?? null) };
			input.click();
		})
	}

	async saveZipToVault(zip: JSZip, vault: Vault, folder: string) {
		console.log(zip.files);
		for (const zipFile of Object.values(zip.files)) {
			const relativePath = zipFile.name;

			if (!zipFile.dir) {

				const content = await zipFile.async("uint8array");
				const fullPath = folder ? `${folder}/${relativePath}` : relativePath;
				const existingFIle = vault.getAbstractFileByPath(fullPath);
				await this.ensureFolderExists(fullPath, this.app.vault);

				if (!relativePath.endsWith(".md")) { 
					if (existingFIle instanceof TFile) { await this.app.fileManager.trashFile(existingFIle) }
					await vault.createBinary(fullPath, content) }
				else {
					const text = new TextDecoder("utf-8").decode(content);
					if (existingFIle instanceof TFile) { await vault.modify(existingFIle, text) } 
					else { await vault.create(fullPath, text) }
				}
			}
		}
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

	async HandleExport() {
		const activeFile = this.app.workspace.getActiveFile();
		if (!activeFile) {
			new Notice("Open file first");
			return;
		}

		const graph = this.buildGraph(activeFile, this.app.metadataCache, this.settings.maxDepth);
		
		const files = new Set(graph.keys());
		const zip = new JSZip();	
		for (const filePath of files) {
			const file = this.app.vault.getAbstractFileByPath(filePath);
			if (file instanceof TFile) {
				const data = await this.app.vault.readBinary(file);
				zip.file(file.path, data);
			}
		}

		const blob = await zip.generateAsync({ type: "blob" });

		await this.shareBlob(blob, `${activeFile.basename}.zip`);
	}

	buildGraph(startFile: TFile, metadataCache: MetadataCache, maxDepth: number): Map<string, Set<string>> {
		const graph = new Map<string, Set<string>>();
		const visited = new Set<string>();
		
		const queue: Array<{ file: TFile; depth: number }> = [{ file: startFile, depth: 0 }];

		while (queue.length > 0) {
			const {file, depth} = queue.shift()!;
			if ((depth > maxDepth || visited.has(file.path)) && this.settings.maxDepth!=-1) continue;
			visited.add(file.path);

			const cache = metadataCache.getFileCache(file);
			const links = cache?.links ?? [];
			const embeds = cache?.embeds ?? [];
		
			const outgoing = new Set<string>();

			for (const item of [...links, ...embeds]) {
				const resolved = metadataCache.getFirstLinkpathDest(item.link, file.path);
				if (resolved) { 
					outgoing.add(resolved.path);
					if (!visited.has(resolved.path)) { queue.push({file: resolved, depth: depth + 1}) }
				}
			}
			graph.set(file.path, outgoing);
		}

		return graph;
	}

	async shareBlob(blob: Blob, filename: string) {
		const file = new File([blob], filename, {type: "application/zip"});

		if (navigator.canShare && navigator.canShare({files: [file]})) {
			navigator.share({ files: [file], title: "Share zip-file" })
		} else {
			const arrayBuffer = await blob.arrayBuffer();
			const exportFolder = this.settings.exportFolder;
			const fullPath = normalizePath(`${exportFolder}/${filename}`);
			
			const existing = this.app.vault.getAbstractFileByPath(fullPath);
			if (existing instanceof TFile) { await this.app.fileManager.trashFile(existing) }

			try {
				await this.app.vault.createFolder(exportFolder);
			} catch (err) { console.error(err) }

			await this.app.vault.createBinary(fullPath, arrayBuffer);

			new Notice(`ZIP created at ${fullPath}`);
			
			if (!this.isMobile()) {
				const adapter = this.app.vault.adapter;
				if (adapter instanceof FileSystemAdapter) {	this.revealInFileExplorer(adapter.getFullPath(fullPath)) }
				else {new Notice("Cannot reveal file in system explorer on this platform")}
			}
   else { this.app.workspace.openLinkText(fullPath, "/", false); }
		}
	}

	isMobile() { return /Mobi|Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) }

	revealInFileExplorer(fullPath: string) {
		try {
			const {shell} = require('electron');
			shell.showItemInFolder(fullPath);
		} catch (err) { console.warn("Cannot open file", err) }
	}
}