# DevX Platform

## Getting Started

### Environment Setup

1. Copy the environment template to create your local configuration:
   ```bash
   cp .env.example .env
   ```

2. Edit `.env` and update the following required variables:
   ```bash
   MYSQL_HOST=your_database_host
   MYSQL_USER=your_database_user
   MYSQL_PASSWORD=your_database_password
   MYSQL_DATABASE=your_database_name
   ```

3. Optional: Configure additional settings in `.env`:
   - `PORT`: Server port (default: 5000)
   - `NODE_ENV`: Environment mode (development/production)

### Development

Run the development server:
```bash
npm run dev
```

### Production

Build and start the production server:
```bash
npm run build
npm start
```

## Environment Variables

The application requires certain environment variables to be set. These can be configured either in your `.env` file (recommended for development) or set directly in your shell.

### Required Variables

- `MYSQL_HOST`: MySQL server hostname
- `MYSQL_USER`: MySQL username
- `MYSQL_PASSWORD`: MySQL password
- `MYSQL_DATABASE`: MySQL database name

### Optional Variables

- `MYSQL_PORT`: MySQL server port (default: 3306)
- `PORT`: Application server port (default: 5000)
- `NODE_ENV`: Environment mode (development/production)

For security:
- Never commit `.env` to version control
- Use separate `.env` files for different environments
- In production, use secure secrets management appropriate for your platform

## Fonts for PDF generation

The server-side PDF generation uses bundled TrueType fonts located in `server/assets/fonts/`. These font files are committed to the repository and are required at runtime (especially on Azure App Service Linux where system fonts are not available). Ensure `server/assets/fonts/LiberationSans-Regular.ttf` exists in your deployment.

CI/CD Note: The Azure Pipelines configuration copies `server/assets/fonts/**` into the backend artifact so the fonts are deployed with the application.
## 📚 Documentation

Complete project documentation is available in the [docs/](docs/) directory:

- **[Deployment Guide](docs/deployment/)** - Azure deployment, environment setup
- **[Developer Guides](docs/guides/)** - Migration, Git Flow, testing, RAG integration
- **[Implementation Details](docs/implementation/)** - Technical architecture and features
- **[Troubleshooting](docs/troubleshooting/)** - Debug guides and issue resolutions
- **[Workflow Reference](docs/workflow/)** - Workflow architecture and APIs
- **[Project Summaries](docs/summaries/)** - Feature implementations and change logs

📖 **[View Full Documentation Index](docs/README.md)**