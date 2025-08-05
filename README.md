# eaZIPeasy
Share your notes as ZIP - easy peasy export and import. Variable lookup depth and mobile support included. 
## Installation
### Downloading release
1. Download the ZIP release.
2. Unpack it at `.obsidian/plugins/`.
3. Activate the plugin in Obsidian settings.
### Building from source
1. Clone repo.
```
git clone <this-repo.git>
```
2. Install modules 
```
npm i
```
2. Compile everything.
```
npm run build
```
3. Move `main.js` and `manifest.json` to `.obsidian/plugins/obsidian-eazipeasy/`.
4. Activate the plugin in Obsidian settings.
## Usage
- Use the `export as zip` command to export the current note as a ZIP archive.
- Use the `import from zip` command to import a ZIP archive into your vault.
## Settings
- **Max Depth** - maximum depth of link triversal: 
  - `0` -  only current file will be exported. 
  - `1` - current file with its links and embeds. 
  - `2` - as `1` plus links of links 
  - and so on... 
  - `-1` - infinite depth. 
  
  Default value - `1`
- **Export Folder** - vault folder where ZIPs will be saved. Default value - `exports`
- **Import Folder** - vault folder where ZIPs will be extracted. Default value - `/` (root)
## License
MIT License (c) 2025 manuwul