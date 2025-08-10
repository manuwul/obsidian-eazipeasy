# eaZIPeasy
Share your notes as ZIP (and other archives) - easy peasy export and import. Variable lookup depth and mobile support included. 
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
3. Compile everything.
```
npm run build
```
4. Move `main.js` and `manifest.json` to `.obsidian/plugins/obsidian-eazipeasy/`.
5. Activate the plugin in Obsidian settings.
## Usage
- Use the `export as ZIP` command to export the current note as a ZIP archive.
- Use the `export as TAR` command to export the current note as a TAR archive.
- Use the `export as TAR.GZ` command to export the current note as a TAR.GZ archive.
- Use the `import from archive` command to import an archive into your vault.
## Settings
- **Max Depth** - maximum depth of link triversal: 
  - `0` -  only current file will be exported. 
  - `1` - current file with its links and embeds. 
  - `2` - as `1` plus links of links 
  - and so on... 
  - `-1` - infinite depth. 
  
  Default value - `1`
- **Export Folder** - vault folder where ZIPs will be saved. Default value - `exports`
- **Ask Password** - should or not ask password every time you create `ZIP`. Default value - `false`
- **Default password** - default password for encrypted `ZIP`. Used only if `Ask Password` is `false`. Empty = `ZIP` will not be encrypted. Default value = `""` (empty)
- **Import Folder** - vault folder where ZIPs will be extracted. Default value - `/` (root)
## License
MIT License (c) 2025 manuwul