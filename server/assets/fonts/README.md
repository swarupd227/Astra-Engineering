# Custom Fonts for PDFKit

## Font: LiberationSans-Regular.ttf

**Why**: PDFKit cannot find system fonts on Azure App Service Linux. This custom font is committed into the repository and must be present at runtime.

**License**: Liberation Fonts are under the SIL Open Font License (OFL)

**Source**: https://github.com/liberationfonts/liberation-fonts/releases/

**Status**: The required TTF files (at minimum `LiberationSans-Regular.ttf`) are committed under this directory and are treated as required runtime assets. Ensure these files are not removed from the repository.

**Installation / Notes for contributors**:
1. If you don't have the files locally, pull the repository — the fonts should be present under `server/assets/fonts/`.
2. If you need to add or update the fonts, download from the official release URL above and commit them into this directory.
3. The PDFKit code will automatically register and use these fonts at runtime via `initializeFonts()`.

**Fallback / Failure Mode**: The PDF generation code intentionally fails fast with a clear error if `LiberationSans-Regular.ttf` is missing. This prevents silent font fallback (AFM/system fonts) on Azure Linux.

## Font Path Resolution

The code uses:
```typescript
const fontPath = path.join(process.cwd(), 'server/assets/fonts/LiberationSans-Regular.ttf');
```

This ensures the font is found in both:
- Local development: /path/to/project/server/assets/fonts/LiberationSans-Regular.ttf
- Azure App Service: /home/site/wwwroot/server/assets/fonts/LiberationSans-Regular.ttf

## CI / Deployment

This repository's Azure Pipelines configuration has been updated to include the `server/assets/fonts/**` path when preparing backend artifacts so the fonts are deployed with the application. Example excerpt from `azure-pipelines.yml`:

```yaml
- task: CopyFiles@2
	displayName: 'Copy files for deployment'
	inputs:
		SourceFolder: '$(packageJsonDir)'
		Contents: |
			dist/**
			server/assets/fonts/**
			package.json
			package-lock.json
			startup.sh
		TargetFolder: '$(Build.ArtifactStagingDirectory)/deploy'
```

If you use a different CI/CD system, ensure `server/assets/fonts/**` is copied into the deployment artifact or the app's runtime root.
